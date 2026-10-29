import "server-only";
import { withCache } from "@/lib/cache";
import { getRuntimeConfig, isDemoMode } from "@/lib/config";
import { todayInTimeZone } from "@/lib/date-time";
import { getLeagueSummaries } from "@/lib/dashboard-service";
import { demoCategories, demoFreeAgents, getDemoMatchups } from "@/lib/demo-data";
import { UpstreamError, ValidationError } from "@/lib/errors";
import { fetchLeagueConfiguration, fetchScoreboard, parseRoster } from "@/lib/yahoo";
import { findAll, objectValue, parseXml, textValue } from "@/lib/xml";
import { fetchYahooXml } from "@/lib/yahoo-client";
import { aggregateTeamContribution, datesInPeriod, parseDailyPlayerStats, parseGameWeeks, type DailyPlayer } from "@/lib/weekly-player-stats";
import { toNumber } from "@/lib/recommender";
import type { MatchupPlayersResponse } from "@/lib/types";

// Keep producers bounded as well as using the shared Yahoo request gate.
async function boundedMap<T, R>(items: T[], loader: (item: T) => Promise<R>) {
  let next = 0;
  const output: R[] = [];
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
    while (next < items.length) { const index = next++; output[index] = await loader(items[index]); }
  }));
  return output;
}
export async function getMatchupPlayers(options: { leagueKey: string; week: number; matchupId: string; forceRefresh?: boolean }): Promise<MatchupPlayersResponse> {
  const { leagueKey, week, matchupId, forceRefresh = false } = options;
  const leagueResult = await getLeagueSummaries(forceRefresh);
  const league = leagueResult.leagues.find((item) => item.leagueKey === leagueKey);
  if (!league || !Number.isInteger(week) || week < league.startWeek || week > league.endWeek) throw new ValidationError("The league or week is unavailable.");
  const demo = isDemoMode();
  const ttl = getRuntimeConfig().cacheTtlSeconds;
  const scoreboardResult = demo ? null : await withCache(`scoreboard:${leagueKey}:${week}`, ttl, () => fetchScoreboard(leagueKey, week), forceRefresh);
  const matchups = demo ? getDemoMatchups(leagueKey, week) : scoreboardResult!.value;
  const matchup = matchups.find((item) => item.id === matchupId && item.week === week);
  if (!matchup) throw new ValidationError("The matchup does not belong to this league and week.");
  const configurationResult = demo ? null : await withCache(`settings:${leagueKey}`, ttl, () => fetchLeagueConfiguration(leagueKey), forceRefresh);
  const configuration = configurationResult?.value;
  const categories = (configuration?.categories ?? demoCategories).filter((item) => item.enabled);
  const reserveSlots = new Set(["BN", "IL", "IL+", "IR", "IR+", "NA"]);
  const activeSlots = new Set((configuration?.rosterPositions ?? []).filter((slot) => slot.count > 0 && !reserveSlots.has(slot.position.toUpperCase())).map((slot) => slot.position.toUpperCase()));
  let startDate = matchup.startDate;
  let endDate = matchup.endDate;
  if (demo) {
    // Explicit sample season, never used for live Yahoo requests.
    startDate = new Date(Date.parse("2025-02-24") + (week - 19) * 7 * 86_400_000).toISOString().slice(0, 10);
    endDate = new Date(Date.parse(startDate) + 6 * 86_400_000).toISOString().slice(0, 10);
  } else if (!startDate || !endDate) {
    const weeks = await withCache(`game-weeks:${league.gameKey}`, 86_400, async () => parseGameWeeks(await fetchYahooXml(`/game/${league.gameKey}/game_weeks`)), forceRefresh);
    const period = weeks.value.find((item) => item.week === week);
    startDate = period?.startDate; endDate = period?.endDate;
  }
  if (!startDate || !endDate) throw new UpstreamError("Yahoo did not provide the matchup dates.");
  datesInPeriod(startDate, endDate);
  const today = todayInTimeZone("America/Los_Angeles");
  const throughDate = startDate > today ? null : endDate < today ? endDate : today;
  const result: MatchupPlayersResponse = { statScope: "fantasy-team-contribution", leagueKey, week, matchupId, startDate, endDate, throughDate,
    categories, status: throughDate ? scoreboardResult?.stale || configurationResult?.stale ? "partial" : "complete" : "not-started", demoMode: demo,
    teams: [matchup.teamA, matchup.teamB].map((team) => ({ teamKey: team.teamKey, name: team.name, players: [], missingRosterDates: [] })) };
  if (!throughDate) return result;
  const dates = datesInPeriod(startDate, throughDate);
  const memberships = new Map(result.teams.map((team) => [team.teamKey, new Map<string, Omit<DailyPlayer, "stats">>()]));
  if (demo) {
    const daily = new Map(dates.map((date) => [date, new Map(demoFreeAgents.slice(0, 4).map((player, index) => [player.playerKey, {
      playerKey: player.playerKey, name: player.name, team: player.team, position: player.position, headshotUrl: player.headshotUrl,
      stats: { "0": 1, "3": 10, "4": 5, "6": 4, "7": 3, "10": 2, "12": 15 + index, "15": 5, "16": 4, "17": 1, "18": 1, "19": 2 },
    }]))]));
    result.teams.forEach((team, index) => { team.players = [...[...daily.values()][0].values()].slice(index * 2, index * 2 + 2).map((player) => aggregateTeamContribution(player, dates, dates, [], daily, categories.map((item) => item.statId))); });
    return result;
  }
  // Daily rosters are cached independently of matchup so opponents reuse the same data.
  const snapshots = await boundedMap(result.teams.flatMap((team) => dates.map((date) => ({ team, date }))), async ({ team, date }) => {
    try {
      const roster = await withCache(`weekly-roster:${team.teamKey}:${date}`, ttl, async () => {
        const xml = await fetchYahooXml(`/team/${team.teamKey}/roster;date=${date}/players`);
        const roster = findAll(parseXml(xml), "roster")[0];
        if (!roster || (textValue(roster.date) && textValue(roster.date) !== date)) throw new UpstreamError("Yahoo returned an unexpected roster date.");
        for (const player of findAll(parseXml(xml), "player")) {
          const selected = objectValue(player.selected_position);
          if (textValue(selected.date) && textValue(selected.date) !== date) throw new UpstreamError("Yahoo returned an unexpected selected-position date.");
        }
        return parseRoster(xml);
      }, forceRefresh);
      return { team, date, players: roster.value, failed: false, stale: roster.stale };
    } catch { return { team, date, players: [], failed: true }; }
  });
  const attribution = new Map(result.teams.map((team) => [team.teamKey, new Map<string, { roster: string[]; scoring: string[]; unknown: string[] }>()]));
  const scoringKeys = new Map(dates.map((date) => [date, new Set<string>()]));
  for (const snapshot of snapshots) {
    const { team, date, players, failed } = snapshot;
    if (failed) { team.missingRosterDates.push(date); result.status = "partial"; }
    if ("stale" in snapshot && snapshot.stale) result.status = "partial";
    for (const player of players) {
      memberships.get(team.teamKey)!.set(player.playerKey, {
        playerKey: player.playerKey, name: player.name, team: player.team, position: player.position, headshotUrl: player.headshotUrl,
      });
      const record = attribution.get(team.teamKey)!.get(player.playerKey) ?? { roster: [], scoring: [], unknown: [] };
      record.roster.push(date);
      const slot = player.selectedPosition?.trim().toUpperCase();
      if (slot && activeSlots.has(slot)) { record.scoring.push(date); scoringKeys.get(date)!.add(player.playerKey); }
      else if (!slot || !reserveSlots.has(slot)) { record.unknown.push(date); result.status = "partial"; }
      attribution.get(team.teamKey)!.set(player.playerKey, record);
    }
  }
  // A trade or differently-aged cache snapshots can report two owners for one scoring date.
  // Treat that as unresolved attribution rather than crediting both sides.
  for (const date of dates) for (const key of [...scoringKeys.get(date)!]) {
    const owners = result.teams.map((team) => attribution.get(team.teamKey)!.get(key)).filter((record) => record?.scoring.includes(date));
    if (owners.length > 1) {
      result.status = "partial"; scoringKeys.get(date)!.delete(key);
      for (const record of owners) { record!.scoring = record!.scoring.filter((day) => day !== date); record!.unknown.push(date); }
    }
  }
  const batches = dates.flatMap((date) => {
    const keys = [...scoringKeys.get(date)!].sort();
    const requests: { date: string; batch: string[] }[] = [];
    for (let index = 0; index < keys.length; index += 25) requests.push({ date, batch: keys.slice(index, index + 25) });
    return requests;
  });
  const daily = new Map<string, Map<string, DailyPlayer>>(dates.map((date) => [date, new Map()]));
  const responses = await boundedMap(batches, async ({ date, batch }) => {
    try {
      const stats = await withCache(`weekly-player-stats:${league.gameKey}:${date}:${batch.join(",")}`, ttl,
        async () => parseDailyPlayerStats(await fetchYahooXml(`/game/${league.gameKey}/players;player_keys=${batch.join(",")}/stats;type=date;date=${date}`), date), forceRefresh);
      if (stats.stale) result.status = "partial";
      return { date, players: stats.value };
    } catch { result.status = "partial"; return { date, players: [] }; }
  });
  for (const response of responses) for (const player of response.players) daily.get(response.date)!.set(player.playerKey, player);
  for (const team of result.teams) {
    team.players = [...memberships.get(team.teamKey)!.values()].map((player) => {
      const record = attribution.get(team.teamKey)!.get(player.playerKey)!;
      return aggregateTeamContribution(player, record.roster, record.scoring, [...record.unknown, ...team.missingRosterDates], daily, categories.map((item) => item.statId));
    });
    if (team.players.some((player) => player.missingDates.length)) result.status = "partial";
    const scoreboard = team.teamKey === matchup.teamA.teamKey ? matchup.teamA.stats : matchup.teamB.stats;
    team.scoreboardCheck = compareContributionTotals(team.players, scoreboard, categories, result.status === "complete");
  }
  return result;
}

function compareContributionTotals(players: MatchupPlayersResponse["teams"][number]["players"], scoreboard: Record<string, string>, categories: MatchupPlayersResponse["categories"], complete: boolean): NonNullable<MatchupPlayersResponse["teams"][number]["scoreboardCheck"]> {
  const differences: { statId: string; displayName: string; playerTotal: number; teamTotal: number }[] = [];
  if (!complete || !players.length) return { status: "unavailable", differences };
  const ratios: Record<string, [string, string]> = { "5": ["4", "3"], "8": ["7", "6"], "11": ["10", "9"], "20": ["16", "19"] };
  let checked = 0;
  for (const category of categories) {
    const ids = ratios[category.statId] ?? [category.statId];
    if (players.some((player) => ids.some((id) => player.stats[id] == null))) continue;
    const totals = ids.map((id) => players.reduce((sum, player) => sum + player.stats[id]!, 0));
    const playerTotal = ids.length === 2 ? totals[1] > 0 ? totals[0] / totals[1] : Number.NaN : totals[0];
    const raw = scoreboard[category.statId];
    const teamTotal = raw?.trim() ? toNumber(raw) : Number.NaN;
    if (!Number.isFinite(playerTotal) || !Number.isFinite(teamTotal)) continue;
    checked++;
    if (Math.abs(playerTotal - teamTotal) > (ids.length === 2 ? .00051 : .000001)) differences.push({ statId: category.statId, displayName: category.displayName, playerTotal, teamTotal });
  }
  return { status: differences.length ? "different" : checked ? "matched" : "unavailable", differences };
}
