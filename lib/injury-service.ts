import "server-only";
import { recordUpdate, withUpdateStatus } from "@/lib/update-status";
import { withCache } from "@/lib/cache";
import { getDashboard } from "@/lib/dashboard-service";
import { getRuntimeConfig, isDemoMode } from "@/lib/config";
import { todayInTimeZone } from "@/lib/date-time";
import { demoFreeAgents } from "@/lib/demo-data";
import { fetchFreeAgentPool, fetchRoster, mergePlayerWindows, parseFreeAgentPage } from "@/lib/yahoo";
import { fetchYahooXml } from "@/lib/yahoo-client";
import { findInjuryOpportunities, injuryPlayer, injuryState } from "@/lib/injury-model";
import { parseDailyPlayerStats } from "@/lib/weekly-player-stats";
import type { FreeAgent } from "@/lib/types";
import type { InjuryResponse } from "@/lib/injury-types";

export interface InjuryOptions { leagueKey: string; teamKey: string; week: number; date: string; timeZone: string; watchKeys: string[]; forceRefresh?: boolean }
export async function getInjuryAdvice(options: InjuryOptions): Promise<InjuryResponse> {
  const { leagueKey, teamKey, week, date, timeZone, watchKeys, forceRefresh = false } = options;
  // getDashboard validates access to the league/team and reuses the dashboard's resources.
  const dashboard = await withUpdateStatus(() => getDashboard({ leagueKey, week, targetDate: date, timeZone, teamKey, forceRefresh }));
  if (dashboard.updateStatus) recordUpdate(dashboard.updateStatus);
  const observationDate = todayInTimeZone("America/Los_Angeles");
  const result: InjuryResponse = { leagueKey, teamKey, generatedAt: new Date().toISOString(), observationDate,
    status: "complete", players: [], rosterKeys: [], opportunities: [], watchlist: [], exclusionCounts: {}, warnings: [], demoMode: isDemoMode() };
  if (date !== todayInTimeZone(timeZone) || week !== dashboard.league.currentWeek) {
    return { ...result, status: "historical", warnings: ["歷史或未來週次／日期不套用目前傷病狀態，請切回當週及今天。"] };
  }
  if (isDemoMode()) {
    const sample = demoFreeAgents[0];
    const player = (key: string, name: string, status: string, recent: number, baseline: number): FreeAgent => ({ ...sample,
      playerKey: key, name, status, team: "BOS", position: "PG", statWindows: {
        lastweek: { "Games Played (GP)": 3, "Minutes Played": recent * 3 }, lastmonth: { "Games Played (GP)": 10, "Minutes Played": baseline * 10 }, season: { "Games Played (GP)": 20, "Minutes Played": baseline * 20 },
      } });
    result.players = [injuryPlayer(player("demo.p.900001", "Demo Lead Guard", "O", 32, 32)), injuryPlayer(player("demo.p.900002", "Demo Backup Guard", "", 29, 19))];
    Object.assign(result, findInjuryOpportunities(result.players, new Set(["demo.p.900002"]), new Map([["demo.p.900002", { score: dashboard.recommendations[0]?.score ?? 0, scoreType: dashboard.recommendations[0]?.scoreType, helps: ["AST", "STL"] }]])));
    return result;
  }
  if (dashboard.updateStatus?.stale || dashboard.dataQuality?.stale || (dashboard.dataQuality && dashboard.dataQuality.status !== "complete")) result.status = "partial";
  const ttl = getRuntimeConfig().cacheTtlSeconds;
  const pool = await withCache(`free-agents:${leagueKey}`, ttl, () => fetchFreeAgentPool(leagueKey), forceRefresh);
  if (pool.stale || pool.value.dataQuality.stale || pool.value.dataQuality.status !== "complete") result.status = "partial";
  const selectedRoster = await withCache(`roster:${teamKey}:${date}`, ttl, () => fetchRoster(leagueKey, teamKey, date), forceRefresh).catch(() => null);
  if (!selectedRoster || selectedRoster.stale || !selectedRoster.value.available || selectedRoster.value.players.some((player) => !player.statWindows)) {
    result.status = "partial"; result.warnings.push("所選球隊陣容或數據不完整，暫不產生復出釋出提醒。");
  }
  result.rosterKeys = selectedRoster?.value.players.map((player) => player.playerKey) ?? [];
  const metadata = await withCache(`injury-taken:${leagueKey}`, ttl, async () => {
    const players: FreeAgent[] = [];
    let complete = false;
    const seen = new Set<string>();
    // Metadata-only enumeration; stats are fetched only for injured and observed players.
    for (let start = 0; start < 1000; start += 25) {
      try {
        const page = parseFreeAgentPage(await fetchYahooXml(`/league/${leagueKey}/players;status=T;start=${start};count=25`), "unavailable");
        if (page.length && page.every((player) => seen.has(player.playerKey))) break;
        for (const player of page) if (!seen.has(player.playerKey)) { seen.add(player.playerKey); players.push(player); }
        if (page.length < 25) { complete = true; break; }
      } catch { break; }
    }
    return { players, complete };
  }, forceRefresh);
  if (metadata.stale || !metadata.value.complete) { result.status = "partial"; result.warnings.push("聯盟已持有球員資料不完整。"); }
  const all = new Map([...metadata.value.players, ...pool.value.players, ...(selectedRoster?.value.players ?? [])].map((player) => [player.playerKey, player]));
  // Taken-player metadata is authoritative for current status; keep any reused stat windows.
  for (const metadataPlayer of metadata.value.players) {
    const existing = all.get(metadataPlayer.playerKey);
    all.set(metadataPlayer.playerKey, { ...existing, ...metadataPlayer,
      stats: existing?.stats ?? metadataPlayer.stats, statWindows: existing?.statWindows ?? metadataPlayer.statWindows });
  }
  const watched = new Set(watchKeys);
  const needingStats = [...all.values()].filter((player) => (!player.statWindows?.lastweek || !player.statWindows?.lastmonth || !player.statWindows?.season) && (watched.has(player.playerKey) || ["out", "watch"].includes(injuryState(player.status ?? ""))));
  for (let index = 0; index < needingStats.length; index += 25) {
    const batch = needingStats.slice(index, index + 25);
    const windows = new Map<string, FreeAgent[]>();
    // Sequential producers avoid filling the global two-slot queue with a stat fanout.
    for (const period of ["lastweek", "lastmonth", "season"] as const) {
      try {
        const stats = await withCache(`injury-window:${leagueKey}:${period}:${batch.map((player) => player.playerKey).sort().join(",")}`, ttl,
          async () => parseFreeAgentPage(await fetchYahooXml(`/game/${dashboard.league.gameKey}/players;player_keys=${batch.map((player) => player.playerKey).join(",")}/stats;type=${period}`), period), forceRefresh);
        if (stats.stale) result.status = "partial";
        for (const player of stats.value) windows.set(player.playerKey, [...(windows.get(player.playerKey) ?? []), player]);
      } catch { result.status = "partial"; }
    }
    for (const player of batch) {
      const stats = mergePlayerWindows(windows.get(player.playerKey) ?? []);
      if (stats) all.set(player.playerKey, { ...player, stats: stats.stats, statWindows: { ...player.statWindows, ...stats.statWindows } });
    }
  }
  result.players = [...all.values()].map(injuryPlayer);
  // Clearing a flag is not proof of a return: use dated GP evidence only for watched players.
  const cleared = result.players.filter((player) => watched.has(player.playerKey) && player.statusKnown && injuryState(player.status) === "clear");
  for (let index = 0; index < cleared.length; index += 25) {
    const batch = cleared.slice(index, index + 25);
    for (let offset = 0; offset < 7; offset++) {
      const day = new Date(Date.parse(observationDate) - offset * 86_400_000).toISOString().slice(0, 10);
      try {
        const played = await withCache(`injury-played:${dashboard.league.gameKey}:${day}:${batch.map((player) => player.playerKey).sort().join(",")}`, ttl,
          async () => parseDailyPlayerStats(await fetchYahooXml(`/game/${dashboard.league.gameKey}/players;player_keys=${batch.map((player) => player.playerKey).join(",")}/stats;type=date;date=${day}`), day), forceRefresh);
        if (played.stale) result.status = "partial";
        for (const player of played.value) if ((player.stats["0"] ?? 0) > 0) batch.find((item) => item.playerKey === player.playerKey)?.playedDates.push(day);
      } catch { result.status = "partial"; }
    }
  }
  const scores = new Map(dashboard.recommendations.map((player) => [player.playerKey, { score: player.score, scoreType: player.scoreType, helps: player.reason }]));
  Object.assign(result, findInjuryOpportunities(result.players, new Set(pool.value.players.filter((player) => !metadata.value.players.some((taken) => taken.playerKey === player.playerKey) && !result.rosterKeys.includes(player.playerKey)).map((player) => player.playerKey)), scores, { points: dashboard.objective === "fantasy-points", limitedData: result.status !== "complete" }));
  if (result.status === "partial") result.warnings.push("部分來源不完整或使用備援資料；候選僅供觀察，不更新復出紀錄。");
  return result;
}
