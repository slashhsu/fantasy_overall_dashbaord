import "server-only";
import { recordUpdate } from "@/lib/update-status";
import { withCache } from "@/lib/cache";
import { getRuntimeConfig, isDemoMode } from "@/lib/config";
import { todayInTimeZone } from "@/lib/date-time";
import { demoFreeAgents, demoLeagues, getDemoMatchups } from "@/lib/demo-data";
import { fetchLeagues, fetchLeagueTeams, fetchRoster } from "@/lib/yahoo";
import { allInjuredPlayers, findInjuryOpportunities, injuryPlayer, injuryState } from "@/lib/injury-model";
import { scanInjuryPlayers } from "@/lib/injury-scan";
import { ValidationError } from "@/lib/errors";
import type { FreeAgent } from "@/lib/types";
import type { InjuryResponse } from "@/lib/injury-types";

export interface InjuryOptions { leagueKey: string; teamKey: string; week: number; date: string; timeZone: string; watchKeys: string[]; forceRefresh?: boolean; cursor?: string }
export async function getInjuryAdvice(options: InjuryOptions): Promise<InjuryResponse> {
  const { leagueKey, teamKey, week, date, timeZone, watchKeys, forceRefresh = false, cursor } = options;
  const ttl = getRuntimeConfig().cacheTtlSeconds, demo = isDemoMode();
  const leagues = demo ? demoLeagues : (await withCache("leagues:current", ttl, fetchLeagues, forceRefresh)).value;
  const league = leagues.find((item) => item.leagueKey === leagueKey);
  if (!league) throw new ValidationError("The selected league is not available for this Yahoo account.");
  if (week < league.startWeek || week > league.endWeek) throw new ValidationError(`Week must be between ${league.startWeek} and ${league.endWeek}.`);
  const teams = demo ? getDemoMatchups(leagueKey, week).flatMap((match) => [match.teamA.teamKey, match.teamB.teamKey])
    : (await withCache(`league-teams:${leagueKey}`, ttl, () => fetchLeagueTeams(leagueKey), forceRefresh)).value.map((team) => team.key);
  if (!teams.includes(teamKey)) throw new ValidationError("The selected team is not in this league.");
  const observationDate = todayInTimeZone("America/Los_Angeles");
  const result: InjuryResponse = { leagueKey, teamKey, generatedAt: new Date().toISOString(), observationDate,
    status: "complete", players: [], injuredPlayers: [], rosterKeys: [], opportunities: [], watchlist: [], exclusionCounts: {}, warnings: [], demoMode: demo };
  if (date !== todayInTimeZone(timeZone) || week !== league.currentWeek) {
    return { ...result, status: "historical", warnings: ["歷史或未來週次／日期不套用目前傷病狀態，請切回當週及今天。"] };
  }
  if (demo) {
    const player = (key: string, name: string, status: string, recent: number, baseline: number, percentOwned: number, availability: FreeAgent["availability"]): FreeAgent => ({ ...demoFreeAgents[0],
      playerKey: key, name, status, team: "BOS", position: "PG", percentOwned, availability, statWindows: {
        lastweek: { "Games Played (GP)": 3, "Minutes Played": recent * 3 }, lastmonth: { "Games Played (GP)": 10, "Minutes Played": baseline * 10 }, season: { "Games Played (GP)": 20, "Minutes Played": baseline * 20 },
      } });
    result.players = [injuryPlayer(player("demo.p.900001", "Demo Lead Guard", "O", 32, 32, 98, "owned")), injuryPlayer(player("demo.p.900002", "Demo Backup Guard", "", 29, 19, 35, "free-agent"))];
    result.injuredPlayers = allInjuredPlayers(result.players);
    result.diagnostics = { players: 2, injured: 1, available: 1 };
    result.scan = { phase: "complete", complete: true, playersScanned: 2, statsProcessed: 2, statsTotal: 2 };
    Object.assign(result, findInjuryOpportunities(result.players, new Set(["demo.p.900002"])));
    return result;
  }
  const scanned = await scanInjuryPlayers({ leagueKey, gameKey: league.gameKey, teamKey, observationDate, watchKeys, cursor, forceRefresh });
  if (scanned.updateStatus) recordUpdate(scanned.updateStatus);
  result.scan = scanned.scan;
  result.warnings.push(...scanned.warnings);
  if (!scanned.scan.complete) result.warnings.push("正在分批掃描，尚未確認已檢查全部球員；可繼續載入。");
  const selectedRoster = await withCache(`roster:${teamKey}:${date}`, ttl, () => fetchRoster(leagueKey, teamKey, date, forceRefresh), forceRefresh).catch(() => null);
  const rosterComplete = Boolean(selectedRoster && !selectedRoster.stale && !selectedRoster.value.stale && selectedRoster.value.available);
  if (!rosterComplete) result.warnings.push("所選球隊陣容資料不完整，暫不產生復出釋出提醒。");
  result.rosterKeys = selectedRoster?.value.players.map((player) => player.playerKey) ?? [];
  const roster = new Map(selectedRoster?.value.players.map((player) => [player.playerKey, player]));
  result.players = scanned.players.map((player) => {
    const owned = roster.get(player.playerKey);
    const merged = { ...player, statWindows: { ...owned?.statWindows, ...player.statWindows } };
    if (result.rosterKeys.includes(player.playerKey)) merged.availability = "owned";
    return { ...injuryPlayer(merged), playedDates: scanned.playedDates[player.playerKey] ?? [] };
  });
  const available = new Set(result.players.filter((player) => player.availability === "free-agent" || player.availability === "waivers").map((player) => player.playerKey));
  result.status = scanned.scan.complete && !scanned.limited && rosterComplete ? "complete" : "partial";
  result.injuredPlayers = allInjuredPlayers(result.players);
  result.diagnostics = { players: result.players.length, injured: result.players.filter((player) => player.statusKnown && ["out", "watch"].includes(injuryState(player.status))).length, available: available.size };
  Object.assign(result, findInjuryOpportunities(result.players, available, { limitedData: !scanned.scan.complete || scanned.limited }));
  if (result.status === "partial") result.warnings.push("來源或掃描尚未完整；不更新復出追蹤紀錄。");
  return result;
}
