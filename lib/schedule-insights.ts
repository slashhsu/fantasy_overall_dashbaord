import "server-only";
import { withCache } from "@/lib/cache";
import { fetchNbaSchedule } from "@/lib/nba-schedule";
import { todayInTimeZone } from "@/lib/date-time";
import { datesInPeriod } from "@/lib/weekly-player-stats";
import { normalizeTeamAbbreviation } from "@/lib/stats";
import type { ScheduleGame, WeeklyTeamSchedule, ConsecutiveGames } from "@/lib/types";

export const NBA_TEAMS = "ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split(" ");
export const shiftScheduleDate = (date: string, delta: number) => new Date(Date.parse(date) + delta * 86400000).toISOString().slice(0, 10);
export const consecutiveDates = (date: string, leagueName: string): [string, string] => {
  const offset = leagueName.includes("離叔") ? 1 : 0;
  return [shiftScheduleDate(date, offset), shiftScheduleDate(date, offset + 1)];
};
export interface ScheduleRange { games: ScheduleGame[]; missingScheduleDates: string[]; complete: boolean }

// Share promises within one dashboard request, including force refreshes of overlapping ranges.
export function createScheduleRangeLoader(timeZone: string, ttl: number, force: boolean) {
  const requests = new Map<string, ReturnType<typeof fetchDay>>();
  const fetchDay = (day: string) => withCache(`nba-schedule:${day}:${timeZone}`, ttl, () => fetchNbaSchedule(day), force);
  return async (start: string, end: string): Promise<ScheduleRange> => {
    const dates = [shiftScheduleDate(start, -1), ...datesInPeriod(start, end), shiftScheduleDate(end, 1)];
    const games = new Map<string, ScheduleGame>();
    const missing = new Set<string>();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, dates.length) }, async () => {
      while (next < dates.length) {
        const day = dates[next++];
        try {
          if (!requests.has(day)) requests.set(day, fetchDay(day));
          const result = await requests.get(day)!;
          if (result.stale || result.value.schedule.status !== "available") { missing.add(day); continue; }
          for (const game of result.value.schedule.games) {
            if (game.status === "postponed") continue;
            if (!game.startTime || !Number.isFinite(Date.parse(game.startTime))) { missing.add(day); continue; }
            const date = todayInTimeZone(timeZone, new Date(game.startTime));
            if (date < start || date > end) continue;
            if (game.status === "unknown") { missing.add(day); continue; }
            const homeTeam = normalizeTeamAbbreviation(game.homeTeam);
            const awayTeam = normalizeTeamAbbreviation(game.awayTeam);
            const tipoff = new Date(game.startTime).toISOString();
            games.set(`${homeTeam}:${awayTeam}:${tipoff}`, { ...game, homeTeam, awayTeam, date });
          }
        } catch { missing.add(day); }
      }
    }));
    return { games: [...games.values()], missingScheduleDates: [...missing].sort(), complete: !missing.size };
  };
}

export function summarizeWeek(startDate: string, endDate: string, timeZone: string, range: ScheduleRange): WeeklyTeamSchedule {
  const counts = new Map(NBA_TEAMS.map((team) => [team, 0]));
  for (const game of range.games) for (const team of [game.homeTeam, game.awayTeam]) counts.set(team, (counts.get(team) ?? 0) + 1);
  const groups = new Map<number, string[]>();
  for (const [team, count] of counts) {
    // Missing data cannot establish zero games.
    if (!range.complete && count === 0) continue;
    groups.set(count, [...(groups.get(count) ?? []), team]);
  }
  return { startDate, endDate, timeZone, status: range.complete ? "complete" : "partial", missingScheduleDates: range.missingScheduleDates,
    groups: [...groups].sort(([a], [b]) => b - a).map(([games, teams]) => ({ games, teams: teams.sort() })) };
}

export function consecutiveGamesForTeam(team: string, dates: [string, string], range: ScheduleRange): ConsecutiveGames {
  const normalized = normalizeTeamAbbreviation(team);
  const playsBoth = dates.every((date) => range.games.some((g) => g.date === date && [g.homeTeam, g.awayTeam].includes(normalized)));
  return { dates, status: playsBoth ? "yes" : range.complete && NBA_TEAMS.includes(normalized) ? "no" : "unknown" };
}
