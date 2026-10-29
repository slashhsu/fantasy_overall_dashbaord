import { parseYahooStatNumber } from "@/lib/stats";
import { isStrictIsoDate } from "@/lib/date-time";
import { UpstreamError } from "@/lib/errors";
import { findAll, objectValue, parseXml, textValue } from "@/lib/xml";
import type { WeeklyPlayer } from "@/lib/types";

export type DailyPlayer = Omit<WeeklyPlayer, "missingDates">;
export function datesInPeriod(start: string, end: string) {
  if (!isStrictIsoDate(start) || !isStrictIsoDate(end) || start > end) throw new UpstreamError("Invalid Yahoo matchup dates.");
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  // Protect against malformed upstream periods, including accidental season-long requests.
  if (days > 35) throw new UpstreamError("Yahoo matchup period is unexpectedly long.");
  return Array.from({ length: days }, (_, index) => new Date(Date.parse(start) + index * 86_400_000).toISOString().slice(0, 10));
}
export function parseGameWeeks(xml: string) {
  return findAll(parseXml(xml), "game_week").map((node) => ({
    week: Number(textValue(node.week)), startDate: textValue(node.start) || textValue(node.start_date),
    endDate: textValue(node.end) || textValue(node.end_date),
  }));
}
export function parseDailyPlayerStats(xml: string, date: string): DailyPlayer[] {
  return findAll(parseXml(xml), "player").flatMap((node) => {
    const data = objectValue(node.player_stats);
    if (textValue(data.coverage_type) !== "date" || textValue(data.date) !== date) return [];
    const stats: Record<string, number | null> = {};
    for (const stat of findAll(data, "stat")) {
      const id = textValue(stat.stat_id);
      stats[id] = parseYahooStatNumber(id, textValue(stat.value));
    }
    return [{ playerKey: textValue(node.player_key), name: textValue(objectValue(node.name).full),
      team: textValue(node.editorial_team_abbr), position: textValue(node.display_position),
      headshotUrl: textValue(objectValue(node.headshot).url) || undefined, stats }];
  }).filter((player) => player.playerKey);
}
const ratios: Record<string, [string, string]> = { "5": ["4", "3"], "8": ["7", "6"], "11": ["10", "9"], "20": ["16", "19"] };
const additive = new Set(["0", "1", "2", "3", "4", "6", "7", "9", "10", "12", "13", "14", "15", "16", "17", "18", "19", "21", "22", "23", "24", "25", "27", "28"]);
export function aggregateWeeklyPlayer(metadata: Omit<DailyPlayer, "stats">, dates: string[], daily: Map<string, Map<string, DailyPlayer>>, statIds: string[]): WeeklyPlayer {
  const required = [...new Set(["0", ...statIds.flatMap((id) => ratios[id] ?? [id])])];
  const missingDates = dates.filter((date) => {
    const stats = daily.get(date)?.get(metadata.playerKey)?.stats;
    return !stats || required.some((id) => stats[id] == null && !(stats["0"] === 0 && additive.has(id)));
  });
  const valueOn = (date: string, id: string): number | null => {
    const stats = daily.get(date)?.get(metadata.playerKey)?.stats;
    return stats?.[id] ?? (stats?.["0"] === 0 && additive.has(id) ? 0 : null);
  };
  const stats: WeeklyPlayer["stats"] = {};
  const incompleteStats: string[] = [];
  for (const id of new Set(["0", ...statIds])) {
    const ratio = ratios[id];
    if (ratio) {
      // Use matching days for numerator and denominator, never mismatched partial totals.
      const pairs = dates.map((date) => ratio.map((part) => valueOn(date, part)));
      const known = pairs.filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);
      if (known.length < dates.length) incompleteStats.push(id);
      const made = known.reduce((sum, pair) => sum + pair[0], 0);
      const attempts = known.reduce((sum, pair) => sum + pair[1], 0);
      stats[id] = attempts > 0 ? made / attempts : null;
    } else if (additive.has(id)) {
      const values = dates.map((date) => valueOn(date, id));
      const known = values.filter((value): value is number => value !== null);
      if (known.length < dates.length) incompleteStats.push(id);
      stats[id] = known.length ? known.reduce((sum, value) => sum + value, 0) : null;
    } else {
      stats[id] = null;
      incompleteStats.push(id);
    }
  }
  return { ...metadata, stats, missingDates, incompleteStats };
}
