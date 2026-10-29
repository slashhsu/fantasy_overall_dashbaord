import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendRemainingWeek, recommendFreeAgentsProbability, evaluateMatchup } from "@/lib/recommender";
import { demoCategories, demoFreeAgents, demoLeagues, getDemoMatchups } from "@/lib/demo-data";
import { loadRecommendationPeriod, upcomingGame } from "@/lib/recommendation-period";
import { fetchNbaSchedule } from "@/lib/nba-schedule";
import { fetchRoster } from "@/lib/yahoo";
import type { ScheduleGame, RosterPlayer } from "@/lib/types";
vi.mock("@/lib/nba-schedule", () => ({ fetchNbaSchedule: vi.fn() }));
vi.mock("@/lib/yahoo", () => ({ fetchRoster: vi.fn() }));
const now = new Date("2030-01-01T00:00:00Z");
const game = (date: string, team = demoFreeAgents[0].team): ScheduleGame => ({ id: date, date, startTime: `${date}T23:00:00Z`, status: "scheduled", homeTeam: team, awayTeam: "XYZ" });
const match = getDemoMatchups("demo.l.101", 19)[0];
const needs = evaluateMatchup(match.teamA, match.teamB, demoCategories);
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); (globalThis as typeof globalThis & { __fantasyCache?: Map<string, unknown> }).__fantasyCache?.clear(); });

describe("remaining-week projection aggregation", () => {
  const opts = { now, targetDate: "2030-01-01", categories: demoCategories, scoringFormat: "each-category" as const, lineupAvailable: true, rosterPositions: [{ position: "Util", count: 1 }] };
  it("includes a player off today, counts back-to-back games, and re-scores totals rather than summing probabilities", () => {
    const days = ["2030-01-02", "2030-01-03"].map((date) => ({ date, games: [game(date)], roster: [] }));
    const row = recommendRemainingWeek([demoFreeAgents[0]], needs, opts, days)[0];
    const single = recommendFreeAgentsProbability([demoFreeAgents[0]], needs, { ...opts, strictGameDay: true, teamsPlaying: [demoFreeAgents[0].team], scheduleGames: [game("2030-01-02")] })[0];
    expect(row).toMatchObject({ remainingGames: 2, usableGames: 2, gameToday: false });
    expect(row.score).not.toBeCloseTo(single.score * 2, 4);
    expect(row.projections).toEqual(single.projections);
    expect(row.categoryImpacts.every((i) => i.projectedProbability >= 0 && i.projectedProbability <= 1)).toBe(true);
  });
  it("reserves already-locked slots and does not promise a usable game", () => {
    const locked: RosterPlayer = { ...demoFreeAgents[1], team: "LOCK", selectedPosition: "Util" };
    const row = recommendRemainingWeek([demoFreeAgents[0]], needs, opts, [{ date: "2030-01-02", games: [game("2030-01-02"), { ...game("2030-01-02", "LOCK"), status: "in-progress" }], roster: [locked] }])[0];
    expect(row.usableGames).toBe(0); expect(row.score).toBe(0);
  });
  it("evaluates accumulated fantasy points and roto gains without multiplying nonlinear scores", () => {
    const days = ["2030-01-02", "2030-01-03"].map((date) => ({ date, games: [game(date)], roster: [] }));
    const points = recommendRemainingWeek([demoFreeAgents[0]], [], { ...opts, scoringFormat: "points", categories: [{ ...demoCategories[0], name: "Points Scored", scoringModifier: 1 }] }, days)[0];
    expect(points.scoreType).toBe("fantasy-points"); expect(points.score).toBeGreaterThan(0);
    const roto = recommendRemainingWeek([demoFreeAgents[0]], [], { ...opts, scoringFormat: "rotisserie", selectedTeamKey: "a", standingsTeams: [{ teamKey: "a", name: "A", stats: { "12": "0" } }, { teamKey: "b", name: "B", stats: { "12": "20" } }], categories: [{ ...demoCategories[0], statId: "12", name: "Points Scored" }] }, days)[0];
    expect(roto.scoreType).toBe("roto-points"); expect(roto.score).toBeLessThanOrEqual(1);
  });
  it("uses each verified daily roster even if the original streaming-date snapshot was unavailable", () => {
    const star: RosterPlayer = { ...demoFreeAgents[0], playerKey: "owned.p.1", name: "Owned", stats: Object.fromEntries(Object.entries(demoFreeAgents[0].stats).map(([k, v]) => [k, k.includes("GP") ? v : Number(v) * 10])) };
    const row = recommendRemainingWeek([demoFreeAgents[0]], needs, { ...opts, lineupAvailable: false }, [{ date: "2030-01-02", games: [game("2030-01-02")], roster: [star] }])[0];
    expect(row.usableGames).toBe(0);
  });
  it("returns no candidates when there are no remaining games", () => { expect(recommendRemainingWeek(demoFreeAgents, needs, opts, [])).toEqual([]); });
});

describe("weekly period and shared inputs", () => {
  const options = { league: demoLeagues[0], matchup: { ...match, startDate: "2029-12-29", endDate: "2030-01-03" }, date: "2029-12-31", timeZone: "America/New_York", teamKey: match.teamA.teamKey, ttl: 300, force: false, weekly: true, demo: false };
  it("handles cross-year non-seven-day periods, timezone boundaries and shared caches for 20 visitors", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    vi.mocked(fetchNbaSchedule).mockImplementation(async (date) => ({ teamsPlaying: [], schedule: { status: "available", source: "espn", fallbackUsed: false, games: date === "2030-01-01" ? [game("2030-01-01")] : [] } }));
    vi.mocked(fetchRoster).mockResolvedValue({ available: true, players: [] });
    const results = await Promise.all(Array.from({ length: 20 }, () => loadRecommendationPeriod(options)));
    expect(results[0].period.status).toBe("complete");
    expect(results[0].period.startDate).toBe("2029-12-31");
    expect(results[0].counts.get(demoFreeAgents[0].team)).toBe(1);
    expect(fetchRoster).toHaveBeenCalledTimes(1);
    expect(fetchNbaSchedule).toHaveBeenCalledTimes(6);
  });
  it("labels partial schedules and unavailable rosters instead of creating false zero/usable totals", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    vi.mocked(fetchNbaSchedule).mockImplementation(async (date) => ({ teamsPlaying: [], schedule: { status: date === "2030-01-02" ? "unavailable" : "available", source: "espn", fallbackUsed: false, games: date === "2030-01-01" ? [game(date)] : [] } }));
    vi.mocked(fetchRoster).mockResolvedValue({ available: false, players: [] });
    const result = await loadRecommendationPeriod(options);
    expect(result.period.status).toBe("partial"); expect(result.scheduleComplete).toBe(false); expect(result.lineupComplete).toBe(false);
    expect(result.period.missingScheduleDates).toEqual(["2030-01-02"]);
  });
  it("does not fetch past weeks or dates beyond the week and excludes locked/postponed games", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const result = await loadRecommendationPeriod({ ...options, date: "2031-01-01" });
    expect(result.period.status).toBe("complete"); expect(result.counts.size).toBe(0); expect(fetchNbaSchedule).not.toHaveBeenCalled();
    expect(upcomingGame({ ...game("2030-01-02"), status: "postponed" }, now)).toBe(false);
    expect(upcomingGame(game("2029-12-30"), now)).toBe(false);
    expect(upcomingGame({ ...game("2030-01-02"), startTime: null }, now)).toBe(false);
  });
});

it("keeps weekly recommendations available for documented clock-style primary schedules and verified off-days", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const actual = await vi.importActual<typeof import("@/lib/nba-schedule")>("@/lib/nba-schedule");
  vi.mocked(fetchNbaSchedule).mockImplementation((date) => actual.fetchNbaSchedule(date, { apiKey: "fixture-key", fetcher: vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(JSON.stringify(String(url).includes("balldontlie")
    ? { data: date === "2030-01-02" ? [{ id: 1, date, datetime: `${date}T23:00:00Z`, status: "7:00 pm ET", home_team: { abbreviation: demoFreeAgents[0].team }, visitor_team: { abbreviation: "MIA" } }] : [] }
    : { events: [] }), { status: 200, headers: { "Content-Type": "application/json" } })) }));
  vi.mocked(fetchRoster).mockResolvedValue({ available: true, players: [] });
  const result = await loadRecommendationPeriod({ league: demoLeagues[0], matchup: { ...match, startDate: "2030-01-01", endDate: "2030-01-03" }, date: "2030-01-01", timeZone: "America/New_York", teamKey: match.teamA.teamKey, ttl: 300, force: false, weekly: true, demo: false });
  expect(result.period.status).toBe("complete");
  expect(result.counts.get(demoFreeAgents[0].team)).toBe(1);
  expect(recommendRemainingWeek([demoFreeAgents[0]], needs, { now, targetDate: "2030-01-01", categories: demoCategories, scoringFormat: "each-category", rosterPositions: [{ position: "Util", count: 1 }] }, result.days)[0]).toMatchObject({ usableGames: 1, remainingGames: 1 });
});

it("does not block a whole week for an IL player's absent stats, but still blocks missing active-player projections", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.mocked(fetchNbaSchedule).mockImplementation(async (date) => ({ teamsPlaying: [], schedule: { status: "available", source: "espn", fallbackUsed: false, games: date === "2030-01-02" ? [game(date)] : [] } }));
  const injured = { ...demoFreeAgents[0], period: "unavailable" as const, selectedPosition: "IL", status: "O", stats: {}, statWindows: undefined };
  vi.mocked(fetchRoster).mockResolvedValue({ available: false, players: [injured] });
  const options = { league: demoLeagues[0], matchup: { ...match, startDate: "2030-01-01", endDate: "2030-01-03" }, date: "2030-01-01", timeZone: "America/New_York", teamKey: "test.t.1", ttl: 300, force: false, weekly: true, demo: false };
  const valid = await loadRecommendationPeriod(options);
  expect(valid.period.status).toBe("complete"); expect(valid.days.flatMap((d) => d.roster)).toHaveLength(0);
  vi.mocked(fetchRoster).mockResolvedValue({ available: false, players: [{ ...injured, selectedPosition: "Util", status: "" }] });
  const invalid = await loadRecommendationPeriod({ ...options, teamKey: "test.t.2" });
  expect(invalid.period.status).toBe("partial"); expect(invalid.lineupComplete).toBe(false);
});
