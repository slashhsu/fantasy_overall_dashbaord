import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheSizeForTests, resetCacheForTests, setCached, withCache } from "@/lib/cache";
import { isIanaTimeZone, isStrictIsoDate } from "@/lib/date-time";
import { buildDraftBoard, nextLinearPicks } from "@/lib/draft-model";
import { evaluateMatchup, recommendFreeAgents } from "@/lib/recommender";
import type { DraftPlayer, FreeAgent, LeagueCategory, MatchupTeam } from "@/lib/types";

const player = (key: string, points: number, games: number, status = ""): FreeAgent => ({
  playerKey: key,
  playerId: key,
  name: key,
  team: "BOS",
  position: "PG",
  eligiblePositions: ["PG", "G", "Util"],
  status,
  period: games > 0 ? "season" : "unavailable",
  projectionSource: games > 0 ? "current-season" : "market-only",
  stats: { "Games Played (GP)": games, "Points Scored": points },
  statWindows: games > 0 ? { season: { "Games Played (GP)": games, "Points Scored": points } } : undefined,
});

describe("production hardening", () => {
  beforeEach(() => resetCacheForTests());

  it("never treats GP=0 totals as per-game production", () => {
    const category: LeagueCategory = { statId: "12", name: "Points Scored", displayName: "PTS", position: 0, enabled: true };
    const needs = evaluateMatchup(
      { teamKey: "a", name: "A", stats: { "12": "90" } },
      { teamKey: "b", name: "B", stats: { "12": "100" } },
      [category],
    );
    const recommendations = recommendFreeAgents([player("market", 900, 0), player("valid", 200, 10)], needs, { strictGameDay: false });
    const market = recommendations.find((item) => item.playerKey === "market");
    expect(market).toMatchObject({ confidence: "Market", projectionSource: "market-only" });
    expect(market?.projections.pts).toBe(0);
    expect(recommendations[0].playerKey).toBe("valid");
  });

  it("risk-adjusts Q/GTD players and caps confidence at Low", () => {
    const category: LeagueCategory = { statId: "12", name: "Points Scored", displayName: "PTS", position: 0, enabled: true };
    const needs = evaluateMatchup(
      { teamKey: "a", name: "A", stats: { "12": "90" } },
      { teamKey: "b", name: "B", stats: { "12": "100" } },
      [category],
    );
    const healthy = player("healthy", 200, 10);
    const questionable = player("questionable", 200, 10, "Q");
    const recommendations = recommendFreeAgents([questionable, healthy], needs, { strictGameDay: false });
    expect(recommendations[0].playerKey).toBe("healthy");
    expect(recommendations.find((item) => item.playerKey === "questionable")).toMatchObject({ confidence: "Low" });
  });

  it("routes points leagues through Yahoo scoring modifiers", () => {
    const categories: LeagueCategory[] = [
      { statId: "12", name: "Points Scored", displayName: "PTS", position: 0, enabled: true, scoringModifier: 1 },
      { statId: "19", name: "Turnovers", displayName: "TO", position: 1, enabled: true, scoringModifier: -2 },
    ];
    const high = { ...player("high", 200, 10), stats: { "Games Played (GP)": 10, "Points Scored": 200, Turnovers: 20 }, statWindows: { season: { "Games Played (GP)": 10, "Points Scored": 200, Turnovers: 20 } } };
    const low = { ...player("low", 120, 10), stats: { "Games Played (GP)": 10, "Points Scored": 120, Turnovers: 5 }, statWindows: { season: { "Games Played (GP)": 10, "Points Scored": 120, Turnovers: 5 } } };
    const ranked = recommendFreeAgents([low, high], [], { scoringFormat: "points", categories, strictGameDay: false });
    expect(ranked[0]).toMatchObject({ playerKey: "high", scoreType: "fantasy-points" });
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("recomputes A/T from cumulative team assists and turnovers", () => {
    const categories: LeagueCategory[] = [
      { statId: "16", name: "Assists", displayName: "AST", position: 0, enabled: true },
      { statId: "60", name: "Assist/Turnover Ratio", displayName: "A/T", position: 1, enabled: true },
    ];
    const team: MatchupTeam = { teamKey: "a", name: "A", stats: { "16": "100", "60": "2.00" } };
    const opponent: MatchupTeam = { teamKey: "b", name: "B", stats: { "16": "100", "60": "2.50" } };
    const make = (key: string, assists: number, turnovers: number): FreeAgent => ({
      ...player(key, 0, 10),
      stats: { "Games Played (GP)": 10, Assists: assists, Turnovers: turnovers },
      statWindows: { season: { "Games Played (GP)": 10, Assists: assists, Turnovers: turnovers } },
    });
    const ranked = recommendFreeAgents([make("efficient", 100, 10), make("careless", 40, 50)], evaluateMatchup(team, opponent, categories), { strictGameDay: false });
    const ratioImpact = ranked[0].categoryImpacts.find((impact) => impact.category === "Assist/Turnover Ratio");
    expect(ranked[0].playerKey).toBe("efficient");
    expect(ratioImpact?.projectedProbability).toBeGreaterThan(ratioImpact?.baselineProbability ?? 1);
    expect(ratioImpact?.coverage).toBe("modeled-unvalidated");
  });

  it("excludes players whose selected-date game has already locked", () => {
    const category: LeagueCategory = { statId: "12", name: "Points Scored", displayName: "PTS", position: 0, enabled: true };
    const needs = evaluateMatchup(
      { teamKey: "a", name: "A", stats: { "12": "90" } },
      { teamKey: "b", name: "B", stats: { "12": "100" } },
      [category],
    );
    const unlocked = { ...player("unlocked", 150, 10), team: "NYK" };
    const ranked = recommendFreeAgents([player("locked", 300, 10), unlocked], needs, {
      teamsPlaying: ["BOS", "NYK"], strictGameDay: true, now: new Date("2026-01-01T20:00:00Z"),
      scheduleGames: [
        { id: "1", date: "2026-01-01", startTime: "2026-01-01T19:00:00Z", status: "in-progress", homeTeam: "BOS", awayTeam: "LAL" },
        { id: "2", date: "2026-01-01", startTime: "2026-01-01T22:00:00Z", status: "scheduled", homeTeam: "NYK", awayTeam: "MIA" },
      ],
    });
    expect(ranked.map((item) => item.playerKey)).toEqual(["unlocked"]);
    expect(ranked[0].lockVerified).toBe(true);
  });

  it("validates real ISO dates and IANA timezones", () => {
    expect(isStrictIsoDate("2026-02-28")).toBe(true);
    expect(isStrictIsoDate("2026-02-30")).toBe(false);
    expect(isIanaTimeZone("Asia/Taipei")).toBe(true);
    expect(isIanaTimeZone("UTC")).toBe(true);
    expect(isIanaTimeZone("Mars/Olympus")).toBe(false);
  });

  it("bounds the LRU cache and deduplicates loaders including stale fallback", async () => {
    for (let index = 0; index < 300; index += 1) setCached(`key-${index}`, index, 60);
    expect(cacheSizeForTests()).toBe(250);
    setCached("stale", 7, -1, 60);
    const loader = vi.fn(async () => { throw new Error("upstream"); });
    const [first, second] = await Promise.all([
      withCache("stale", 60, loader),
      withCache("stale", 60, loader),
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ value: 7, cached: true, stale: true });
    expect(second).toEqual(first);
  });

  it("supports linear turns and salary-cap price fields", () => {
    expect(nextLinearPicks(6, 10, 3)).toMatchObject({ nextUserPick: 13, followingUserPick: 23 });
    const draftPlayers: DraftPlayer[] = Array.from({ length: 20 }, (_, index) => ({
      playerKey: `p${index}`, playerId: String(index), name: `Player ${index}`, team: "BOS", position: "PG",
      eligiblePositions: ["PG"], yahooRank: index + 1,
      draftAnalysis: { averagePick: index + 1, averageRound: 1, averageCost: 20 - index / 2, percentDrafted: 1 },
      gamesPlayed: 40, projectionSeason: 2025, projectionSource: "previous-season",
      stats: { "Points Scored": 30 - index },
    }));
    const board = buildDraftBoard({
      players: draftPlayers,
      categories: [{ statId: "12", name: "Points Scored", displayName: "PTS", position: 0, enabled: true }],
      rosterPositions: [{ position: "PG", count: 2 }], scoringFormat: "each-category", teamCount: 10,
      draftSlot: 1, draftMode: "salary-cap", auctionBudget: 200, draftedPlayerKeys: [], userPlayerKeys: [],
    });
    expect(board.rankings[0].recommendedPrice).toBeGreaterThan(0);
    expect(board.rankings[0].estimatedReturn).toBeNull();
    expect(board.rankings[0].maxBid).toBe(199);
  });
});
