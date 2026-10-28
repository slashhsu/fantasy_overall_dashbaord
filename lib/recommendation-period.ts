import "server-only";
import { withCache } from "@/lib/cache";
import { fetchNbaSchedule } from "@/lib/nba-schedule";
import { fetchRoster } from "@/lib/yahoo";
import { fetchYahooXml } from "@/lib/yahoo-client";
import { datesInPeriod, parseGameWeeks } from "@/lib/weekly-player-stats";
import { todayInTimeZone } from "@/lib/date-time";
import type { LeagueSummary, Matchup, RecommendationPeriod, RosterPlayer, ScheduleGame } from "@/lib/types";

export const upcomingGame = (game: ScheduleGame, now = new Date()) =>
  game.status === "scheduled" && Boolean(game.startTime) && Date.parse(game.startTime!) > now.getTime();

export async function loadRecommendationPeriod(options: {
  league: LeagueSummary; matchup: Matchup; date: string; timeZone: string; teamKey: string;
  ttl: number; force: boolean; weekly: boolean; demo: boolean;
}) {
  const { league, matchup, date, timeZone, ttl, force, weekly, demo } = options;
  const period: RecommendationPeriod = { startDate: matchup.startDate ?? null, endDate: matchup.endDate ?? null, timeZone, status: "unavailable" };
  const days: Array<{ date: string; games: ScheduleGame[]; roster: RosterPlayer[] }> = [];
  const counts = new Map<string, number>();
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
    const now = new Date();
    const start = [date, period.startDate, todayInTimeZone(timeZone, now)].sort().at(-1)!;
    const end = period.endDate;
    period.startDate = start;
    if (start > end) { period.status = "complete"; period.message = "此區間已無可用比賽"; return { period, days, counts, lineupComplete: true }; }
    const dates = datesInPeriod(start, end);
    const shift = (date: string, delta: number) => new Date(Date.parse(date) + delta * 86400000).toISOString().slice(0, 10);
    // Providers group slates in their own timezone; pad both boundaries and deduplicate tipoffs.
    const queryDates = [shift(start, -1), ...dates, shift(end, 1)];
    const gamesById = new Map<string, ScheduleGame>();
    let next = 0; let scheduleComplete = true; let lineupComplete = true;
    const bounded = async (items: string[], load: (date: string) => Promise<void>) => {
      next = 0;
      await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
        while (next < items.length) await load(items[next++]);
      }));
    };
    await bounded(queryDates, async (day) => {
      try {
        const result = await withCache(`nba-schedule:${day}:${timeZone}`, ttl, () => fetchNbaSchedule(day), force);
        if (result.stale || result.value.schedule.status !== "available") { scheduleComplete = false; return; }
        for (const game of result.value.schedule.games) {
          if (game.status === "unknown" || (!game.startTime && game.status === "scheduled")) scheduleComplete = false;
          if (!game.startTime || !Number.isFinite(Date.parse(game.startTime)) || game.status === "postponed") continue;
          const localDate = todayInTimeZone(timeZone, new Date(game.startTime!));
          if (localDate >= start && localDate <= end) gamesById.set(`${game.homeTeam}:${game.awayTeam}:${game.startTime}`, { ...game, date: localDate });
        }
      } catch { scheduleComplete = false; }
    });
    for (const game of [...gamesById.values()].filter((g) => upcomingGame(g, now))) for (const team of [game.homeTeam, game.awayTeam]) counts.set(team, (counts.get(team) ?? 0) + 1);
    await bounded(dates, async (day) => {
      const games = [...gamesById.values()].filter((g) => g.date === day);
      let roster: RosterPlayer[] = [];
      if (weekly && games.length) {
        try {
          const snapshot = await withCache(`roster:${options.teamKey}:${day}`, ttl, () => fetchRoster(league.leagueKey, options.teamKey, day, force), force);
          if (!snapshot.value.available || snapshot.stale || snapshot.value.stale || snapshot.value.players.some((p) => p.period === "unavailable")) lineupComplete = false;
          roster = snapshot.value.players;
        } catch { lineupComplete = false; }
      }
      days.push({ date: day, games, roster });
    });
    period.status = scheduleComplete && (!weekly || lineupComplete) ? "complete" : "partial";
    period.message = !scheduleComplete ? "部分賽程未知；僅顯示已確認至少場次，整週評分暫停。" : !lineupComplete ? "每日陣容不足或使用備援；無法可靠評估可排入場次。" : undefined;
    return { period, days: days.sort((a, b) => a.date.localeCompare(b.date)), counts, lineupComplete, scheduleComplete };
  } catch {
    period.message = "無法取得此週的完整日期或賽程，請稍後重試或切回當日推薦。";
    return { period, days, counts, lineupComplete: false, scheduleComplete: false };
  }
}
