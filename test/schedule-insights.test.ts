import { afterEach, describe, expect, it, vi } from "vitest";
import { consecutiveDates, consecutiveGamesForTeam, createScheduleRangeLoader, summarizeWeek } from "@/lib/schedule-insights";
import { fetchNbaSchedule } from "@/lib/nba-schedule";
import type { ScheduleGame } from "@/lib/types";
vi.mock("@/lib/nba-schedule", () => ({ fetchNbaSchedule: vi.fn() }));
const game = (date: string, status: ScheduleGame["status"] = "scheduled"): ScheduleGame => ({ id: date, date, startTime: `${date}T20:00:00Z`, status, homeTeam: "GSW", awayTeam: "POR" });
const range = (games: ScheduleGame[], complete = true) => ({ games, complete, missingScheduleDates: complete ? [] : ["2030-02-01"] });
afterEach(() => { vi.resetAllMocks(); (globalThis as typeof globalThis & { __fantasyCache?: Map<string, unknown> }).__fantasyCache?.clear(); });

describe("streaming schedule insights", () => {
  it("selects league-specific dates across month, year and week boundaries", () => {
    expect(consecutiveDates("2030-01-31", "一般盟")).toEqual(["2030-01-31", "2030-02-01"]);
    expect(consecutiveDates("2030-12-31", "離叔的盟")).toEqual(["2031-01-01", "2031-01-02"]);
    expect(consecutiveDates("2026-11-22", "一般盟")).toEqual(["2026-11-22", "2026-11-23"]);
  });
  it("distinguishes both, one, neither, missing data and unknown teams", () => {
    const dates: [string, string] = ["2030-01-31", "2030-02-01"];
    expect(consecutiveGamesForTeam("GS", dates, range(dates.map((d) => game(d)))).status).toBe("yes");
    expect(consecutiveGamesForTeam("GSW", dates, range([game(dates[0])])).status).toBe("no");
    expect(consecutiveGamesForTeam("GSW", dates, range([])).status).toBe("no");
    expect(consecutiveGamesForTeam("GSW", dates, range([game(dates[0])], false)).status).toBe("unknown");
    expect(consecutiveGamesForTeam("GSW", dates, range(dates.map((d) => game(d)), false)).status).toBe("yes");
    expect(consecutiveGamesForTeam("FA", dates, range([])).status).toBe("unknown");
  });
  it("groups full-week counts descending and tied teams alphabetically, including all 30 teams", () => {
    const summary = summarizeWeek("2030-01-28", "2030-02-03", "UTC", range([game("2030-01-28", "final"), game("2030-01-29", "in-progress"), game("2030-02-01")]));
    expect(summary.groups[0]).toEqual({ games: 3, teams: ["GSW", "POR"] });
    expect(summary.groups[1].games).toBe(0);
    expect(summary.groups.flatMap((g) => g.teams)).toHaveLength(30);
    const partial = summarizeWeek("2030-01-28", "2030-02-03", "UTC", range([game("2030-02-01")], false));
    expect(partial.status).toBe("partial"); expect(partial.groups).toEqual([{ games: 1, teams: ["GSW", "POR"] }]);
  });
  it("pads dates, uses local dates at DST, normalizes and deduplicates sources and excludes postponed/unknown games", async () => {
    const event = { ...game("2030-03-10", "final"), startTime: "2030-03-11T00:30:00Z", homeTeam: "GS" };
    vi.mocked(fetchNbaSchedule).mockResolvedValue({ teamsPlaying: [], schedule: { status: "available", source: "espn", fallbackUsed: false, games: [event, { ...event, id: "other-source", startTime: "2030-03-11T00:30:00+00:00", homeTeam: "GSW" }, game("2030-03-10", "postponed"), { ...game("2030-03-10", "unknown"), startTime: "2030-03-11T01:00:00Z" }] } });
    const result = await createScheduleRangeLoader("America/New_York", 300, false)("2030-03-10", "2030-03-10");
    expect(result.games).toHaveLength(1); expect(result.games[0]).toMatchObject({ date: "2030-03-10", homeTeam: "GSW", status: "final" });
    expect(result.complete).toBe(false);
    expect(fetchNbaSchedule).toHaveBeenCalledTimes(3);
  });
  it("shares overlapping refresh requests and handles failures without reporting false zeroes", async () => {
    vi.mocked(fetchNbaSchedule).mockImplementation(async (date) => {
      if (date === "2030-02-01") throw new Error("offline");
      return { teamsPlaying: [], schedule: { status: "available", source: "espn", fallbackUsed: false, games: [] } };
    });
    const load = createScheduleRangeLoader("UTC", 300, true);
    await load("2030-01-31", "2030-02-01");
    const result = await load("2030-02-01", "2030-02-02");
    expect(fetchNbaSchedule).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({ complete: false, missingScheduleDates: ["2030-02-01"] });
  });
});
