import type {
  FreeAgent,
  LeagueCategory,
  MatchupCategoryRow,
  MatchupTeam,
  Recommendation,
} from "@/lib/types";
import { normalizeTeamAbbreviation } from "@/lib/stats";

export const LOWER_IS_BETTER = new Set([
  "Turnovers",
  "Personal Fouls",
  "Technical Fouls",
  "Ejections",
  "Flagrant Fouls",
  "Times Fouled Out",
]);

interface PercentageCategory {
  made: string[];
  attempted: string[];
}

const PERCENTAGE_CATEGORIES: Record<string, PercentageCategory> = {
  "Field Goal Percentage": {
    made: ["Field Goals Made (FGM)", "Field Goals Made"],
    attempted: ["Field Goals Attempted (FGA)", "Field Goals Attempted"],
  },
  "Free Throw Percentage": {
    made: ["Free Throws Made (FTM)", "Free Throws Made"],
    attempted: ["Free Throws Attempted (FTA)", "Free Throws Attempted"],
  },
  "3-point Percentage": {
    made: ["Three-Pointers Made (3PM)", "3-point Shots Made"],
    attempted: ["Three-Pointers Attempted (3PA)", "3-point Shots Attempted"],
  },
};

const COUNT_STATS: Record<string, string[]> = {
  "Field Goals Made": ["Field Goals Made (FGM)", "Field Goals Made"],
  "Field Goals Attempted": ["Field Goals Attempted (FGA)", "Field Goals Attempted"],
  "Free Throws Made": ["Free Throws Made (FTM)", "Free Throws Made"],
  "Free Throws Attempted": ["Free Throws Attempted (FTA)", "Free Throws Attempted"],
  "3-point Shots Made": ["Three-Pointers Made (3PM)", "3-point Shots Made"],
  "3-point Shots Attempted": ["Three-Pointers Attempted (3PA)", "3-point Shots Attempted"],
  "Points Scored": ["Points Scored", "Total Points (PTS)", "Total Points Game(PTS)"],
  "Total Rebounds": ["Total Rebounds", "Total Rebounds (REB)"],
  "Offensive Rebounds": ["Offensive Rebounds", "Offensive Rebounds (OREB)"],
  "Defensive Rebounds": ["Defensive Rebounds", "Defensive Rebounds (DREB)"],
  Assists: ["Assists", "Assists (AST)"],
  Steals: ["Steals", "Steals (STL)"],
  "Blocked Shots": ["Blocked Shots", "Blocks (BLK)", "Blocks"],
  Blocks: ["Blocked Shots", "Blocks (BLK)", "Blocks"],
  Turnovers: ["Turnovers", "Turnovers (TO)"],
  "Double-Doubles": ["Double-Doubles"],
  "Personal Fouls": ["Personal Fouls", "Personal Fouls (PF)"],
  "Assist/Turnover Ratio": ["Assist/Turnover Ratio", "Assist/Turnover Ratio (A/T)", "A/T"],
};

export const splitRatio = (value: unknown): [number, number] => {
  const parts = String(value ?? "").trim().split("/");
  if (parts.length !== 2) return [Number.NaN, Number.NaN];
  return [toNumber(parts[0]), toNumber(parts[1])];
};

export const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim().replaceAll(",", "");
  if (!text || text === "-" || text === "--" || text.toLowerCase() === "nan") {
    return Number.NaN;
  }
  if (text.includes("/")) {
    const [made, attempted] = splitRatio(text);
    return attempted ? made / attempted : Number.NaN;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const priority = (side: MatchupCategoryRow["side"], level: number | null) => {
  if (side === "Draw") return 3.25;
  if (level === null) return 0;
  if (side === "Lose") return ({ 1: 4, 2: 2.75, 3: 1.25, 4: 0.35 })[level] ?? 0;
  if (side === "Win") return ({ 1: 1.1, 2: 0.35, 3: 0, 4: 0 })[level] ?? 0;
  return 0;
};

const resultFor = (category: string, teamValue: number, opponentValue: number) => {
  if (!Number.isFinite(teamValue) || !Number.isFinite(opponentValue)) {
    return { result: "No Data", side: "No Data" as const, level: null };
  }
  if (teamValue === opponentValue) {
    return { result: "Draw", side: "Draw" as const, level: null };
  }

  const lower = LOWER_IS_BETTER.has(category);
  const winning = lower ? teamValue < opponentValue : teamValue > opponentValue;
  const side = winning ? ("Win" as const) : ("Lose" as const);
  const base = Math.abs(teamValue) > 1e-9 ? Math.abs(teamValue) : 1;
  const differenceRatio = Math.abs(teamValue - opponentValue) / base;
  const thresholds = category in PERCENTAGE_CATEGORIES ? [0.05, 0.1, 0.15] : [0.1, 0.2, 0.3];
  const level = differenceRatio < thresholds[0] ? 1 : differenceRatio < thresholds[1] ? 2 : differenceRatio < thresholds[2] ? 3 : 4;
  return { result: `${side} ${level}`, side, level };
};

export const evaluateMatchup = (
  team: MatchupTeam,
  opponent: MatchupTeam,
  categories: LeagueCategory[],
): MatchupCategoryRow[] =>
  categories
    .filter((category) => category.enabled)
    .map((category) => {
      const teamRawValue = team.stats[category.statId] ?? "";
      const opponentRawValue = opponent.stats[category.statId] ?? "";
      const teamNumber = toNumber(teamRawValue);
      const opponentNumber = toNumber(opponentRawValue);
      const outcome = resultFor(category.name, teamNumber, opponentNumber);
      return {
        statId: category.statId,
        category: category.name,
        displayName: category.displayName,
        teamValue: Number.isFinite(teamNumber) ? teamNumber : null,
        opponentValue: Number.isFinite(opponentNumber) ? opponentNumber : null,
        teamRawValue,
        opponentRawValue,
        result: outcome.result,
        side: outcome.side,
        level: outcome.level,
        priorityWeight: priority(outcome.side, outcome.level),
        lowerIsBetter: LOWER_IS_BETTER.has(category.name),
      };
    })
    .sort((left, right) => right.priorityWeight - left.priorityWeight);

const firstStat = (player: FreeAgent, candidates: string[]) => {
  for (const candidate of candidates) {
    const value = player.stats[candidate];
    if (Number.isFinite(value)) return value;
  }
  return 0;
};

const perGame = (player: FreeAgent, candidates: string[]) => {
  const value = firstStat(player, candidates);
  const games = firstStat(player, ["Games Played (GP)", "GP"]);
  return games > 0 ? value / games : value;
};

const zScores = (values: number[]) => {
  if (!values.length) return [];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  if (!standardDeviation) return values.map(() => 0);
  return values.map((value) => (value - mean) / standardDeviation);
};

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export interface RecommendationOptions {
  teamsPlaying?: Iterable<string>;
  strictGameDay?: boolean;
  topN?: number;
}

export const recommendFreeAgents = (
  freeAgents: FreeAgent[],
  needs: MatchupCategoryRow[],
  options: RecommendationOptions = {},
): Recommendation[] => {
  const playingTeams = new Set(
    [...(options.teamsPlaying ?? [])].map(normalizeTeamAbbreviation),
  );
  const pool = freeAgents.filter((player) => {
    if (!options.strictGameDay) return true;
    return playingTeams.has(normalizeTeamAbbreviation(player.team));
  });

  const contributions = pool.map(() => new Map<string, number>());
  const scores = pool.map(() => 0);

  for (const need of needs) {
    if (need.priorityWeight <= 0) continue;
    let metrics: number[] | undefined;

    const percentage = PERCENTAGE_CATEGORIES[need.category];
    if (percentage) {
      const target = need.side === "Lose" || need.side === "Draw"
        ? (need.opponentValue ?? 0)
        : (need.teamValue ?? 0);
      metrics = pool.map(
        (player) => perGame(player, percentage.made) - target * perGame(player, percentage.attempted),
      );
    } else if (need.category === "Assist/Turnover Ratio") {
      metrics = pool.map((player) => firstStat(player, COUNT_STATS[need.category]));
    } else if (COUNT_STATS[need.category]) {
      metrics = pool.map((player) => {
        const value = perGame(player, COUNT_STATS[need.category]);
        return LOWER_IS_BETTER.has(need.category) ? -value : value;
      });
    }

    if (!metrics) continue;
    const standardized = zScores(metrics);
    standardized.forEach((value, index) => {
      const contribution = value * need.priorityWeight;
      scores[index] += contribution;
      contributions[index].set(need.category, contribution);
    });
  }

  return pool
    .map((player, index): Recommendation => {
      const gamesPlayed = firstStat(player, ["Games Played (GP)", "GP"]);
      const reliability = Math.sqrt(Math.min(Math.max(gamesPlayed, 0), 8) / 8);
      const adjustedScore = scores[index] * (0.75 + 0.25 * reliability);
      const sortedContributions = [...contributions[index].entries()].sort((a, b) => b[1] - a[1]);
      const reason = sortedContributions.filter(([, value]) => value > 0.35).slice(0, 3).map(([name]) => name);
      const watchouts = sortedContributions.filter(([, value]) => value < -0.75).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([name]) => name);
      return {
        playerKey: player.playerKey,
        name: player.name,
        position: player.position,
        team: normalizeTeamAbbreviation(player.team),
        headshotUrl: player.headshotUrl,
        gameToday: playingTeams.has(normalizeTeamAbbreviation(player.team)),
        period: player.period,
        gamesPlayed,
        score: round(adjustedScore),
        reason,
        watchouts,
        projections: {
          pts: round(perGame(player, COUNT_STATS["Points Scored"])),
          reb: round(perGame(player, COUNT_STATS["Total Rebounds"])),
          ast: round(perGame(player, COUNT_STATS.Assists)),
          stl: round(perGame(player, COUNT_STATS.Steals)),
          blk: round(perGame(player, COUNT_STATS["Blocked Shots"])),
          threePm: round(perGame(player, COUNT_STATS["3-point Shots Made"])),
          turnovers: round(perGame(player, COUNT_STATS.Turnovers)),
        },
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, options.topN ?? 50);
};
