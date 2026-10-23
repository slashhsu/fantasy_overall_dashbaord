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
      const raw = textValue(stat.value).replaceAll(",", "").trim();
      stats[textValue(stat.stat_id)] = raw !== "" && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) ? Number(raw) : null;
    }
    return [{ playerKey: textValue(node.player_key), name: textValue(objectValue(node.name).full),
      team: textValue(node.editorial_team_abbr), position: textValue(node.display_position),
      headshotUrl: textValue(objectValue(node.headshot).url) || undefined, stats }];
  }).filter((player) => player.playerKey);
}
const ratios: Record<string, [string, string]> = { "5": ["4", "3"], "8": ["7", "6"], "11": ["10", "9"], "20": ["16", "19"] };
const additive = new Set(["0", "3", "4", "6", "7", "9", "10", "12", "13", "14", "15", "16", "17", "18", "19", "21", "22", "23", "24", "25", "26", "27", "28", "29"]);
export function aggregateWeeklyPlayer(metadata: Omit<DailyPlayer, "stats">, dates: string[], daily: Map<string, Map<string, DailyPlayer>>, statIds: string[]): WeeklyPlayer {
  const required = [...new Set(["0", ...statIds.flatMap((id) => ratios[id] ?? [id])])];
  const missingDates = dates.filter((date) => {
    const stats = daily.get(date)?.get(metadata.playerKey)?.stats;
    return !stats || required.some((id) => stats[id] == null && !(stats["0"] === 0 && additive.has(id)));
  });
  const sums: Record<string, number | null> = {};
  for (const id of additive) {
    const values = dates.map((date) => {
      const stats = daily.get(date)?.get(metadata.playerKey)?.stats;
      // Explicit GP=0 establishes a no-appearance day for counting stats only.
      return stats?.[id] ?? (stats?.["0"] === 0 ? 0 : null);
    });
    sums[id] = values.some((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  }
  const stats: WeeklyPlayer["stats"] = {};
  for (const id of new Set(["0", ...statIds])) {
    const ratio = ratios[id];
    if (ratio) {
      const [made, attempted] = ratio.map((part) => sums[part]);
      stats[id] = made !== null && attempted !== null && attempted > 0 ? made / attempted : null;
    } else stats[id] = sums[id] ?? null;
  }
  return { ...metadata, stats, missingDates };
}
