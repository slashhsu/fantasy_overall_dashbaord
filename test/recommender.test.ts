import { describe, expect, it } from "vitest";
import { demoCategories, demoFreeAgents, getDemoMatchups } from "@/lib/demo-data";
import { evaluateMatchup, recommendFreeAgents, splitRatio, toNumber } from "@/lib/recommender";

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
});
