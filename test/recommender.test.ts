import { describe, expect, it } from "vitest";
import { demoCategories, demoFreeAgents, getDemoMatchups } from "@/lib/demo-data";
import { canUseSlot, evaluateMatchup, normalCdf, poissonBinomialOutcomeValue, recommendFreeAgents, recommendFreeAgentsProbability, splitRatio, toNumber } from "@/lib/recommender";
import { RECOMMENDER_MODEL, SELECTED_RECOMMENDER } from "@/lib/recommender-model";
import type { FreeAgent, LeagueCategory, MatchupTeam } from "@/lib/types";

describe("recommender parity", () => {
  it("parses Yahoo numbers and made/attempted ratios", () => {
    expect(splitRatio("37/82")).toEqual([37, 82]);
    expect(toNumber("37/82")).toBeCloseTo(0.4512, 4);
    expect(toNumber("1,024")).toBe(1024);
    expect(Number.isNaN(toNumber("--"))).toBe(true);
  });

  it("assigns the Python priority weights to close losses, draws, and close wins", () => {
    const matchup = getDemoMatchups("demo.l.101", 19)[0];
    const needs = evaluateMatchup(matchup.teamA, matchup.teamB, demoCategories);
    const assists = needs.find((row) => row.category === "Assists");
    const steals = needs.find((row) => row.category === "Steals");
    expect(assists?.side).toBe("Lose");
    expect(assists?.priorityWeight).toBe(4);
    expect(steals?.side).toBe("Win");
    expect(steals?.priorityWeight).toBe(1.1);
  });

  it("treats turnovers as lower-is-better", () => {
    const matchup = getDemoMatchups("demo.l.101", 19)[0];
    const needs = evaluateMatchup(matchup.teamA, matchup.teamB, demoCategories);
    const turnovers = needs.find((row) => row.category === "Turnovers");
    expect(turnovers).toMatchObject({ side: "Win", lowerIsBetter: true });
  });

  it("uses made-minus-target-attempt impact for percentage categories", () => {
    const matchup = getDemoMatchups("demo.l.101", 19)[0];
    const needs = evaluateMatchup(matchup.teamA, matchup.teamB, demoCategories);
    const recommendations = recommendFreeAgents(demoFreeAgents, needs, {
      teamsPlaying: ["ORL", "MIA", "GSW", "BOS", "DET", "NYK"],
      strictGameDay: true,
    });
    expect(recommendations.length).toBeGreaterThan(3);
    expect(recommendations.every((player) => player.gameToday)).toBe(true);
    expect(recommendations[0].reason.length).toBeGreaterThan(0);
    expect(recommendations.map((player) => player.name)).toContain("Anthony Black");
  });

  it("orders the saved-style sample deterministically", () => {
    const matchup = getDemoMatchups("demo.l.101", 19)[0];
    const needs = evaluateMatchup(matchup.teamA, matchup.teamB, demoCategories);
    const firstRun = recommendFreeAgents(demoFreeAgents, needs, { strictGameDay: false });
    const secondRun = recommendFreeAgents(demoFreeAgents, needs, { strictGameDay: false });
    expect(firstRun.map((player) => player.playerKey)).toEqual(secondRun.map((player) => player.playerKey));
    expect(firstRun[0].score).toBeGreaterThanOrEqual(firstRun[1].score);
  });

  it("promotes the probability scorer after it clears the completed historical gate", () => {
    expect(SELECTED_RECOMMENDER).toBe("probability");
    expect(RECOMMENDER_MODEL).toMatchObject({
      id: "matchup-swing",
      selectedModel: "probability",
      selectionStatus: "historical-validated",
    });
  });

  it("distinguishes a confirmed no-games day from an unavailable schedule", () => {
    const matchup = getDemoMatchups("demo.l.101", 19)[0];
    const needs = evaluateMatchup(matchup.teamA, matchup.teamB, demoCategories);
    const confirmedNoGames = recommendFreeAgents(demoFreeAgents, needs, {
      teamsPlaying: [],
      strictGameDay: true,
    });
    const scheduleUnavailable = recommendFreeAgents(demoFreeAgents, needs, {
      teamsPlaying: [],
      strictGameDay: false,
    });
    expect(confirmedNoGames).toEqual([]);
    expect(scheduleUnavailable).toHaveLength(demoFreeAgents.length);
  });

  it("keeps probability functions monotonic and gives ties half value", () => {
    expect(normalCdf(-1)).toBeLessThan(normalCdf(0));
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1)).toBeGreaterThan(normalCdf(0));
    expect(poissonBinomialOutcomeValue([1, 0])).toBe(0.5);
    expect(poissonBinomialOutcomeValue([1, 1, 0])).toBe(1);
  });

  it("uses blended windows and scores the net value over a displaced starter", () => {
    const category: LeagueCategory = {
      statId: "12", name: "Points Scored", displayName: "PTS", position: 0, enabled: true,
    };
    const team: MatchupTeam = { teamKey: "l.t.1", name: "Team", stats: { "12": "90" } };
    const opponent: MatchupTeam = { teamKey: "l.t.2", name: "Opponent", stats: { "12": "100" } };
    const needs = evaluateMatchup(team, opponent, [category]);
    const makePlayer = (playerKey: string, name: string, points: number, status = ""): FreeAgent => ({
      playerKey,
      name,
      position: "PG",
      eligiblePositions: ["PG", "G", "Util"],
      team: "BOS",
      status,
      period: "lastmonth",
      stats: { "Games Played (GP)": 10, "Points Scored": points * 10 },
      statWindows: {
        season: { "Games Played (GP)": 40, "Points Scored": points * 40 },
        lastmonth: { "Games Played (GP)": 10, "Points Scored": points * 10 },
        lastweek: { "Games Played (GP)": 3, "Points Scored": points * 3 },
      },
    });
    const weakStarter = makePlayer("starter", "Weak Starter", 5);
    const candidate = makePlayer("candidate", "Candidate", 20);
    const inactive = makePlayer("inactive", "Inactive Star", 40, "INJ");
    const recommendations = recommendFreeAgentsProbability([candidate, inactive], needs, {
      teamsPlaying: ["BOS"],
      strictGameDay: true,
      targetDate: "2026-02-20",
      roster: [weakStarter],
      rosterPositions: [{ position: "Util", count: 1 }],
      lineupAvailable: true,
    });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      name: "Candidate",
      projectionBasis: "blended",
      lineupImpact: { status: "replaces", displacedPlayer: "Weak Starter" },
    });
    expect(recommendations[0].score).toBeGreaterThan(0);
    expect(canUseSlot(candidate, "G")).toBe(true);
    expect(canUseSlot(candidate, "C")).toBe(false);
  });

  it("uses attempt-volume fallback without erasing Yahoo percentage signal", () => {
    const category: LeagueCategory = {
      statId: "5", name: "Field Goal Percentage", displayName: "FG%", position: 0, enabled: true,
    };
    const needs = evaluateMatchup(
      { teamKey: "l.t.1", name: "Team", stats: { "5": "45/100" } },
      { teamKey: "l.t.2", name: "Opponent", stats: { "5": "50/100" } },
      [category],
    );
    const percentagePlayer = (playerKey: string, percentage: number, status = ""): FreeAgent => ({
      playerKey,
      name: playerKey,
      position: "SG",
      eligiblePositions: ["SG", "G", "Util"],
      team: "BOS",
      status,
      period: "season",
      stats: { "Games Played (GP)": 40, "Field Goal Percentage": percentage },
      statWindows: { season: { "Games Played (GP)": 40, "Field Goal Percentage": percentage } },
    });
    const recommendations = recommendFreeAgentsProbability([
      percentagePlayer("efficient", 0.6, "Q"),
      percentagePlayer("inefficient", 0.35),
    ], needs, { strictGameDay: false, targetDate: "2026-02-20" });
    expect(recommendations[0].name).toBe("efficient");
    expect(recommendations[0].confidence).toBe("Low");
    expect(recommendations[0].score).toBeGreaterThan(recommendations[1].score);
  });

  it("falls back to normalized blended scoring for unsupported categories", () => {
    const category: LeagueCategory = {
      statId: "99", name: "Custom Hustle", displayName: "HUSTLE", position: 0, enabled: true,
    };
    const needs = evaluateMatchup(
      { teamKey: "l.t.1", name: "Team", stats: { "99": "10" } },
      { teamKey: "l.t.2", name: "Opponent", stats: { "99": "12" } },
      [category],
    );
    const customPlayer = (playerKey: string, value: number): FreeAgent => ({
      playerKey,
      name: playerKey,
      position: "PF",
      team: "BOS",
      period: "season",
      stats: { "Games Played (GP)": 10, "Custom Hustle": value },
      statWindows: { season: { "Games Played (GP)": 10, "Custom Hustle": value } },
    });
    const recommendations = recommendFreeAgentsProbability([
      customPlayer("high", 50), customPlayer("low", 10),
    ], needs, { strictGameDay: false });
    expect(recommendations[0]).toMatchObject({ name: "high", scoreType: "blended-z-score" });
    expect(recommendations[0].score).toBeGreaterThan(recommendations[1].score);
  });
});
