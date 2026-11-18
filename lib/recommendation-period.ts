import "server-only";
import { normalizeTeamAbbreviation } from "@/lib/stats";
import { withCache } from "@/lib/cache";
import { createScheduleRangeLoader, consecutiveDates, summarizeWeek } from "@/lib/schedule-insights";
import { fetchRoster } from "@/lib/yahoo";
import { fetchYahooXml } from "@/lib/yahoo-client";
import { datesInPeriod, parseGameWeeks } from "@/lib/weekly-player-stats";
import { todayInTimeZone } from "@/lib/date-time";
import type { LeagueSummary, Matchup, RecommendationPeriod, RosterPlayer, ScheduleGame, WeeklyTeamSchedule } from "@/lib/types";

export const upcomingGame = (game: ScheduleGame, now = new Date()) =>
  game.status === "scheduled" && Boolean(game.startTime) && Date.parse(game.startTime!) > now.getTime();

const reserveList = (player: RosterPlayer) => ["IL", "IL+", "NA"].includes((player.selectedPosition ?? "").toUpperCase());
const needsProjection = (player: RosterPlayer, games: ScheduleGame[], now: Date) => !reserveList(player)
  && !["O", "OUT", "INJ", "IL", "IL+", "NA", "SUSP"].includes((player.status ?? "").toUpperCase())
  && games.some((game) => upcomingGame(game, now) && [game.homeTeam, game.awayTeam].includes(normalizeTeamAbbreviation(player.team)));

export async function loadRecommendationPeriod(options: {
  league: LeagueSummary; matchup: Matchup; date: string; timeZone: string; teamKey: string;
  ttl: number; force: boolean; weekly: boolean; demo: boolean;
}) {
  const { league, matchup, date, timeZone, ttl, force, weekly, demo } = options;
  const period: RecommendationPeriod = { startDate: matchup.startDate ?? null, endDate: matchup.endDate ?? null, timeZone, status: "unavailable" };
  const days: Array<{ date: string; games: ScheduleGame[]; roster: RosterPlayer[] }> = [];
  const counts = new Map<string, number>();
  const loadRange = createScheduleRangeLoader(timeZone, ttl, force);
  const backToBackDates = consecutiveDates(date, league.name);
  const backToBackRange = await loadRange(...backToBackDates);
  let weeklyTeamSchedule: WeeklyTeamSchedule = { startDate: null, endDate: null, timeZone, status: "unavailable", groups: [], missingScheduleDates: [] };
  const insights = () => ({ weeklyTeamSchedule, backToBackDates, backToBackRange });
  try {
    if (demo) {
      period.startDate = new Date(Date.parse("2025-02-24") + (matchup.week - 19) * 7 * 86_400_000).toISOString().slice(0, 10);
      period.endDate = new Date(Date.parse(period.startDate) + 6 * 86_400_000).toISOString().slice(0, 10);
    } else if (!period.startDate || !period.endDate) {
      const weeks = await withCache(`game-weeks:${league.gameKey}`, 86400, async () => parseGameWeeks(await fetchYahooXml(`/game/${league.gameKey}/game_weeks`)), force);
      if (weeks.stale) throw new Error("週次日曆為備援資料");
      const week = weeks.value.find((w) => w.week === matchup.week);
      period.startDate = week?.startDate ?? null; period.endDate = week?.endDate ?? null;
    }
    if (!period.startDate || !period.endDate) throw new Error("Yahoo 未提供週次日期");
    datesInPeriod(period.startDate, period.endDate);
    weeklyTeamSchedule = summarizeWeek(period.startDate, period.endDate, timeZone, await loadRange(period.startDate, period.endDate));
    const now = new Date();
    const start = [date, period.startDate, todayInTimeZone(timeZone, now)].sort().at(-1)!;
    const end = period.endDate;
    period.startDate = start;
    if (start > end) { period.status = "complete"; period.message = "此區間已無可用比賽"; return { ...insights(), period, days, counts, lineupComplete: true, scheduleComplete: true }; }
    const dates = datesInPeriod(start, end);
    const range = await loadRange(start, end);
    const scheduleComplete = range.complete;
    let next = 0; let lineupComplete = true;
    const missingScheduleDates = new Set(range.missingScheduleDates);
    const bounded = async (items: string[], load: (date: string) => Promise<void>) => {
      next = 0;
      await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
        while (next < items.length) await load(items[next++]);
      }));
    };
    for (const game of range.games.filter((g) => upcomingGame(g, now))) for (const team of [game.homeTeam, game.awayTeam]) counts.set(team, (counts.get(team) ?? 0) + 1);
    await bounded(dates, async (day) => {
      const games = range.games.filter((g) => g.date === day);
      let roster: RosterPlayer[] = [];
      if (weekly && games.length) {
        try {
          const snapshot = await withCache(`roster:${options.teamKey}:${day}`, ttl, () => fetchRoster(league.leagueKey, options.teamKey, day, force), force);
          const relevant = snapshot.value.players.filter((player) => needsProjection(player, games, now));
          if (snapshot.stale || snapshot.value.stale || relevant.some((p) => p.period === "unavailable")
            || (!snapshot.value.available && (!snapshot.value.players.length || relevant.length > 0))) lineupComplete = false;
          // Inactive/IL players and off-day players don't need projections for this day's comparison.
          // Keep locked starters' metadata so their already-used slots remain reserved.
          roster = snapshot.value.players.filter((player) => !reserveList(player));
        } catch { lineupComplete = false; }
      }
      days.push({ date: day, games, roster });
    });
    period.missingScheduleDates = [...missingScheduleDates].sort();
    period.status = scheduleComplete && (!weekly || lineupComplete) ? "complete" : "partial";
    period.message = !scheduleComplete ? `部分賽程未知（${period.missingScheduleDates.join("、")}）；僅顯示已確認至少場次，整週評分暫停。可切回當日推薦。` : !lineupComplete ? "每日陣容不足或使用備援；無法可靠評估可排入場次。" : undefined;
    return { ...insights(), period, days: days.sort((a, b) => a.date.localeCompare(b.date)), counts, lineupComplete, scheduleComplete };
  } catch {
    period.message = "無法取得此週的完整日期或賽程，請稍後重試或切回當日推薦。";
    return { ...insights(), period, days, counts, lineupComplete: false, scheduleComplete: false };
  }
}
