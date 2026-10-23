import { describe, expect, it } from "vitest";
import { aggregateWeeklyPlayer, datesInPeriod, parseDailyPlayerStats, parseGameWeeks, type DailyPlayer } from "@/lib/weekly-player-stats";
const meta = { playerKey: "nba.p.1", name: "Test Player", team: "BOS", position: "PG" };
const daily = (stats: Record<string, number | null>): DailyPlayer => ({ ...meta, stats });
describe("actual weekly player stats", () => {
  it("uses real period boundaries across years and long matchup weeks", () => {
    expect(datesInPeriod("2025-12-29", "2026-01-08")).toHaveLength(11);
    expect(datesInPeriod("2025-12-29", "2026-01-08")[3]).toBe("2026-01-01");
    expect(() => datesInPeriod("2026-02-30", "2026-03-01")).toThrow();
    expect(parseGameWeeks('<fantasy_content><game_weeks><game_week><week>1</week><start>2026-10-20</start><end>2026-10-25</end></game_week></game_weeks></fantasy_content>')[0]).toMatchObject({ week: 1, startDate: "2026-10-20" });
  });
  it("adds counts and recomputes percentages using attempts, not daily averages", () => {
    const dates = ["2026-10-20", "2026-10-21"];
    const data = new Map(dates.map((date, index) => [date, new Map([[meta.playerKey, daily({ "0": 1, "12": index ? 10 : 20, "3": index ? 2 : 10, "4": index ? 2 : 4, "5": index ? 1 : 0.4 })]])]));
    const result = aggregateWeeklyPlayer(meta, dates, data, ["12", "5"]);
    expect(result.stats).toMatchObject({ "0": 2, "12": 30, "5": 0.5 });
    expect(result.missingDates).toEqual([]);
  });
  it("distinguishes missing stats, explicit zero and DNP, and never divides by zero", () => {
    const date = "2026-10-20";
    const result = aggregateWeeklyPlayer(meta, [date], new Map([[date, new Map([[meta.playerKey, daily({ "0": 0 })]])]]), ["12", "5"]);
    expect(result.stats).toEqual({ "0": 0, "12": 0, "5": null });
    expect(result.missingDates).toEqual([]);
    const missing = aggregateWeeklyPlayer(meta, [date], new Map(), ["12"]);
    expect(missing.stats["12"]).toBeNull(); expect(missing.missingDates).toEqual([date]);
  });
  it("preserves played-day values when other dates are missing, rather than erasing the entire week", () => {
    const dates = ["2026-10-20", "2026-10-21", "2026-10-22"];
    const data = new Map([[dates[1], new Map([[meta.playerKey, daily({ "0": 1, "12": 25, "3": 10, "4": 5 })]])]]);
    const result = aggregateWeeklyPlayer(meta, dates, data, ["12", "5"]);
    expect(result.stats).toEqual({ "0": 1, "12": 25, "5": 0.5 });
    expect(result.incompleteStats).toEqual(["0", "12", "5"]);
    expect(result.missingDates).toEqual([dates[0], dates[2]]);
  });
  it("only computes partial percentages from days with both shot components", () => {
    const dates = ["2026-10-20", "2026-10-21"];
    const data = new Map(dates.map((date, index) => [date, new Map([[meta.playerKey, daily(index ? { "0": 1, "4": 9, "3": null } : { "0": 1, "4": 5, "3": 10 })]])]));
    expect(aggregateWeeklyPlayer(meta, dates, data, ["5"]).stats["5"]).toBe(0.5);
  });
  it("parses stat IDs and rejects responses for the wrong date or period", () => {
    const xml = '<fantasy_content><players><player><player_key>nba.p.1</player_key><player_stats><coverage_type>date</coverage_type><date>2026-10-20</date><stats><stat><stat_id>12</stat_id><value>0</value></stat><stat><stat_id>5</stat_id><value>-</value></stat></stats></player_stats></player></players></fantasy_content>';
    expect(parseDailyPlayerStats(xml, "2026-10-20")[0].stats).toEqual({ "12": 0, "5": null });
    expect(parseDailyPlayerStats(xml, "2026-10-21")).toEqual([]);
    expect(parseDailyPlayerStats(xml.replace("<coverage_type>date", "<coverage_type>season"), "2026-10-20")).toEqual([]);
  });
});
