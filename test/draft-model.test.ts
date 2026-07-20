import { describe, expect, it } from "vitest";
import { buildDraftBoard, nextSnakePicks } from "@/lib/draft-model";
import type { DraftPlayer, LeagueCategory, RosterPosition } from "@/lib/types";

const categories: LeagueCategory[] = [
  { statId: "5", name: "Field Goal Percentage", displayName: "FG%", position: 0, enabled: true },
  { statId: "8", name: "Free Throw Percentage", displayName: "FT%", position: 1, enabled: true },
  { statId: "10", name: "3-point Shots Made", displayName: "3PM", position: 2, enabled: true },
  { statId: "12", name: "Points Scored", displayName: "PTS", position: 3, enabled: true },
  { statId: "15", name: "Total Rebounds", displayName: "REB", position: 4, enabled: true },
  { statId: "16", name: "Assists", displayName: "AST", position: 5, enabled: true },
  { statId: "17", name: "Steals", displayName: "STL", position: 6, enabled: true },
  { statId: "18", name: "Blocked Shots", displayName: "BLK", position: 7, enabled: true },
  { statId: "19", name: "Turnovers", displayName: "TO", position: 8, enabled: true },
];

const rosterPositions: RosterPosition[] = [
  { position: "PG", count: 1 },
  { position: "SG", count: 1 },
  { position: "SF", count: 1 },
  { position: "PF", count: 1 },
  { position: "C", count: 1 },
  { position: "Util", count: 2 },
  { position: "BN", count: 2 },
];

const player = (
  id: string,
  name: string,
  position: string,
  adp: number,
  line: { fg: number; ft: number; three: number; pts: number; reb: number; ast: number; stl: number; blk: number; to: number },
): DraftPlayer => ({
  playerKey: `500.p.${id}`,
  playerId: id,
  name,
  position,
  eligiblePositions: position.split(","),
  team: "TST",
  yahooRank: adp,
  draftAnalysis: { averagePick: adp, averageRound: adp / 10, averageCost: null, percentDrafted: 1 },
  gamesPlayed: 65,
  projectionSeason: 2025,
  projectionSource: "previous-season",
  stats: {
    "Field Goal Percentage": line.fg,
    "Field Goals Attempted (FGA)": 12,
    "Free Throw Percentage": line.ft,
    "Free Throws Attempted (FTA)": 5,
    "Three-Pointers Made (3PM)": line.three,
    "Points Scored": line.pts,
    "Total Rebounds": line.reb,
    Assists: line.ast,
    Steals: line.stl,
    "Blocked Shots": line.blk,
    Turnovers: line.to,
  },
});

const pool = [
  player("1", "Lead Guard", "PG", 8, { fg: .46, ft: .88, three: 3.2, pts: 26, reb: 4, ast: 9, stl: 1.5, blk: .2, to: 4 }),
  player("2", "Rim Anchor", "C", 14, { fg: .64, ft: .61, three: 0, pts: 14, reb: 12, ast: 2, stl: .7, blk: 2.6, to: 1.7 }),
  player("3", "Scoring Wing", "SG,SF", 20, { fg: .47, ft: .84, three: 3.8, pts: 24, reb: 5, ast: 3, stl: 1, blk: .4, to: 2.1 }),
  player("4", "Two Way Forward", "SF,PF", 29, { fg: .51, ft: .78, three: 1.8, pts: 18, reb: 8, ast: 4, stl: 1.8, blk: 1.2, to: 1.8 }),
  player("5", "Backup Guard", "PG,SG", 45, { fg: .43, ft: .81, three: 2.1, pts: 15, reb: 3, ast: 6, stl: .9, blk: .1, to: 2.8 }),
];

describe("dynamic draft model", () => {
  it("calculates upcoming picks for a snake draft", () => {
    expect(nextSnakePicks(1, 10, 6)).toEqual({ nextUserPick: 6, followingUserPick: 15, round: 1, picksUntilTurn: 5 });
    expect(nextSnakePicks(7, 10, 6)).toEqual({ nextUserPick: 15, followingUserPick: 26, round: 1, picksUntilTurn: 8 });
  });

  it("raises a scarce category specialist when that category is targeted", () => {
    const balanced = buildDraftBoard({
      players: pool,
      categories,
      rosterPositions,
      scoringFormat: "each-category",
      teamCount: 10,
      draftSlot: 1,
      draftedPlayerKeys: [pool[0].playerKey],
      userPlayerKeys: [pool[0].playerKey],
    });
    const targetBlocks = buildDraftBoard({
      players: pool,
      categories,
      rosterPositions,
      scoringFormat: "each-category",
      teamCount: 10,
      draftSlot: 1,
      draftedPlayerKeys: [pool[0].playerKey],
      userPlayerKeys: [pool[0].playerKey],
      categoryModes: { "18": "target", "8": "punt" },
    });
    const balancedRank = balanced.rankings.find((ranking) => ranking.player.name === "Rim Anchor")?.rank ?? 99;
    const targetRank = targetBlocks.rankings.find((ranking) => ranking.player.name === "Rim Anchor")?.rank ?? 99;
    expect(targetRank).toBeLessThanOrEqual(balancedRank);
    expect(targetBlocks.rankings[0].categoryScores.find((score) => score.statId === "8")?.weightedScore).toBe(0);
  });

  it("uses Yahoo market value without inventing category production", () => {
    const marketPool = pool.slice(0, 2).map((item, index) => ({
      ...item,
      gamesPlayed: 0,
      projectionSeason: null,
      projectionSource: "market-only" as const,
      stats: {},
      draftAnalysis: { ...item.draftAnalysis, averagePick: index === 0 ? 4 : 48 },
    }));
    const result = buildDraftBoard({
      players: marketPool,
      categories,
      rosterPositions,
      scoringFormat: "each-category",
      teamCount: 10,
      draftSlot: 1,
      draftedPlayerKeys: [],
      userPlayerKeys: [],
    });
    expect(result.rankings[0].player.name).toBe("Lead Guard");
    expect(result.rankings[0].confidence).toBe("Market");
    expect(result.rankings[0].watchouts).toContain("ADP only; no category history");
  });

  it("reports lower next-turn availability for players whose ADP is earlier", () => {
    const result = buildDraftBoard({
      players: pool,
      categories,
      rosterPositions,
      scoringFormat: "each-category",
      teamCount: 10,
      draftSlot: 1,
      draftedPlayerKeys: [],
      userPlayerKeys: [],
    });
    const early = result.rankings.find((ranking) => ranking.player.name === "Lead Guard");
    const late = result.rankings.find((ranking) => ranking.player.name === "Backup Guard");
    expect(early?.availabilityNextTurn ?? 100).toBeLessThan(late?.availabilityNextTurn ?? 0);
  });
});
