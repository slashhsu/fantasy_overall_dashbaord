import type {
  FreeAgent,
  LeagueCategory,
  LeagueScoringFormat,
  MatchupCategoryRow,
  MatchupTeam,
  Recommendation,
  RecommendationCategoryImpact,
  RosterPlayer,
  RosterPosition,
} from "@/lib/types";
import { MODEL_PARAMETERS } from "@/lib/recommender-model";
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

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export interface RecommendationOptions {
  teamsPlaying?: Iterable<string>;
  strictGameDay?: boolean;
  topN?: number;
  targetDate?: string;
  roster?: RosterPlayer[];
  rosterPositions?: RosterPosition[];
  lineupAvailable?: boolean;
  scoringFormat?: LeagueScoringFormat;
}

const PROJECTION_STATS: Record<string, string[]> = {
  gp: ["Games Played (GP)", "GP"],
  pts: COUNT_STATS["Points Scored"],
  reb: COUNT_STATS["Total Rebounds"],
  ast: COUNT_STATS.Assists,
  stl: COUNT_STATS.Steals,
  blk: COUNT_STATS["Blocked Shots"],
  threePm: COUNT_STATS["3-point Shots Made"],
  turnovers: COUNT_STATS.Turnovers,
  fgm: PERCENTAGE_CATEGORIES["Field Goal Percentage"].made,
  fga: PERCENTAGE_CATEGORIES["Field Goal Percentage"].attempted,
  ftm: PERCENTAGE_CATEGORIES["Free Throw Percentage"].made,
  fta: PERCENTAGE_CATEGORIES["Free Throw Percentage"].attempted,
  threePa: PERCENTAGE_CATEGORIES["3-point Percentage"].attempted,
};

interface PlayerProjection {
  player: FreeAgent;
  rates: Record<string, number>;
  sampleSize: number;
}

const firstStatValue = (stats: Record<string, number> | undefined, candidates: string[]) => {
  if (!stats) return 0;
  for (const candidate of candidates) {
    const value = stats[candidate];
    if (Number.isFinite(value)) return value;
  }
  return 0;
};

const windowsFor = (player: FreeAgent) => player.statWindows ?? (
  player.period === "unavailable" ? {} : { [player.period]: player.stats }
);

const gamesIn = (stats: Record<string, number> | undefined) =>
  firstStatValue(stats, PROJECTION_STATS.gp);

const rawBlendedRate = (player: FreeAgent, candidates: string[]) => {
  const windows = windowsFor(player);
  let weightedRate = 0;
  let totalWeight = 0;
  for (const period of ["season", "lastmonth", "lastweek"] as const) {
    const stats = windows[period];
    const games = gamesIn(stats);
    if (!stats || games <= 0) continue;
    weightedRate += (firstStatValue(stats, candidates) / games) * MODEL_PARAMETERS.windowWeights[period];
    totalWeight += MODEL_PARAMETERS.windowWeights[period];
  }
  if (totalWeight > 0) return weightedRate / totalWeight;
  const games = firstStatValue(player.stats, PROJECTION_STATS.gp);
  const value = firstStatValue(player.stats, candidates);
  return games > 0 ? value / games : value;
};

const projectionPriors = (players: FreeAgent[]) => Object.fromEntries(
  Object.entries(PROJECTION_STATS)
    .filter(([key]) => key !== "gp")
    .map(([key, candidates]) => {
      const values = players.map((player) => rawBlendedRate(player, candidates)).filter(Number.isFinite);
      return [key, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0];
    }),
) as Record<string, number>;

const projectPlayer = (player: FreeAgent, priors: Record<string, number>): PlayerProjection => {
  const windows = windowsFor(player);
  const sampleSize = Math.max(...Object.values(windows).map(gamesIn), 0);
  const reliability = sampleSize / (sampleSize + MODEL_PARAMETERS.priorGames);
  const rates: Record<string, number> = {};
  for (const [key, candidates] of Object.entries(PROJECTION_STATS)) {
    if (key === "gp") continue;
    const observed = rawBlendedRate(player, candidates);
    rates[key] = observed * reliability + (priors[key] ?? 0) * (1 - reliability);
  }
  return { player, rates, sampleSize };
};

const statusCode = (player: FreeAgent) => (player.status ?? "").trim().toUpperCase();
const confirmedInactive = (player: FreeAgent) => new Set(["O", "OUT", "INJ", "IL", "IL+", "NA", "SUSP"]).has(statusCode(player));
const questionable = (player: FreeAgent) => new Set(["DTD", "GTD", "Q", "D"]).has(statusCode(player));

const erf = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
};

export const normalCdf = (value: number) => 0.5 * (1 + erf(value / Math.sqrt(2)));

export const poissonBinomialOutcomeValue = (probabilities: number[]) => {
  const distribution = Array(probabilities.length + 1).fill(0) as number[];
  distribution[0] = 1;
  probabilities.forEach((probability, index) => {
    for (let wins = index + 1; wins >= 0; wins -= 1) {
      distribution[wins] = (distribution[wins] ?? 0) * (1 - probability)
        + (wins > 0 ? (distribution[wins - 1] ?? 0) * probability : 0);
    }
  });
  const majority = Math.floor(probabilities.length / 2) + 1;
  const wins = distribution.slice(majority).reduce((sum, value) => sum + value, 0);
  const ties = probabilities.length % 2 === 0 ? distribution[probabilities.length / 2] : 0;
  return wins + ties * 0.5;
};

const weekdayIndex = (targetDate: string) => {
  const day = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
  return (day + 6) % 7;
};

const residualDeviation = (category: string, targetDate: string) => {
  const weekly = MODEL_PARAMETERS.weeklyResidualStandardDeviation[category] ?? 1;
  const remainingFraction = Math.max(1 / 7, (7 - weekdayIndex(targetDate)) / 7);
  return Math.max(weekly * 0.28, weekly * Math.sqrt(remainingFraction));
};

const percentageKeys = (category: string) => {
  if (category === "Field Goal Percentage") return { made: "fgm", attempted: "fga" };
  if (category === "Free Throw Percentage") return { made: "ftm", attempted: "fta" };
  if (category === "3-point Percentage") return { made: "threePm", attempted: "threePa" };
  return undefined;
};

const estimatedAttempts = (category: string, targetDate: string) => {
  const weekly = MODEL_PARAMETERS.averageWeeklyAttempts[category as keyof typeof MODEL_PARAMETERS.averageWeeklyAttempts] ?? 100;
  return weekly * ((weekdayIndex(targetDate) + 1) / 7);
};

const categoryContribution = (category: string, projection: PlayerProjection) => {
  const percentage = percentageKeys(category);
  if (percentage) {
    return {
      made: projection.rates[percentage.made] ?? 0,
      attempted: projection.rates[percentage.attempted] ?? 0,
    };
  }
  if (category === "Assist/Turnover Ratio") {
    const turnovers = projection.rates.turnovers || 0;
    return { value: turnovers > 0 ? projection.rates.ast / turnovers : projection.rates.ast };
  }
  const candidates = COUNT_STATS[category];
  if (!candidates) return undefined;
  const key = Object.entries(PROJECTION_STATS).find(([, names]) => names === candidates)?.[0];
  if (key) return { value: projection.rates[key] ?? 0 };
  return { value: rawBlendedRate(projection.player, candidates) };
};

const subtractProjection = (candidate: PlayerProjection, displaced?: PlayerProjection): PlayerProjection => ({
  player: candidate.player,
  sampleSize: candidate.sampleSize,
  rates: Object.fromEntries(
    Object.keys(candidate.rates).map((key) => [key, candidate.rates[key] - (displaced?.rates[key] ?? 0)]),
  ),
});

interface ProbabilityScore {
  score: number;
  scoreType: Recommendation["scoreType"];
  impacts: RecommendationCategoryImpact[];
}

const probabilityScore = (
  needs: MatchupCategoryRow[],
  projection: PlayerProjection,
  targetDate: string,
  scoringFormat: LeagueScoringFormat,
): ProbabilityScore => {
  const impacts: RecommendationCategoryImpact[] = [];
  for (const need of needs) {
    if (need.teamValue === null || need.opponentValue === null) continue;
    const contribution = categoryContribution(need.category, projection);
    if (!contribution) continue;
    const sigma = residualDeviation(need.category, targetDate);
    let baselineGap = need.teamValue - need.opponentValue;
    let projectedGap = baselineGap;

    if ("made" in contribution) {
      const [rawMade, rawAttempts] = splitRatio(need.teamRawValue);
      const attempts = Number.isFinite(rawAttempts) && rawAttempts > 0
        ? rawAttempts
        : estimatedAttempts(need.category, targetDate);
      const made = Number.isFinite(rawMade) ? rawMade : need.teamValue * attempts;
      const nextAttempts = Math.max(1, attempts + (contribution.attempted ?? 0));
      const nextMade = Math.max(0, made + (contribution.made ?? 0));
      projectedGap = nextMade / nextAttempts - need.opponentValue;
    } else {
      projectedGap += contribution.value;
    }

    if (need.lowerIsBetter) {
      baselineGap *= -1;
      projectedGap *= -1;
    }
    const baselineProbability = normalCdf(baselineGap / sigma);
    const projectedProbability = normalCdf(projectedGap / sigma);
    impacts.push({
      category: need.category,
      displayName: need.displayName,
      baselineProbability,
      projectedProbability,
      delta: projectedProbability - baselineProbability,
    });
  }

  if (scoringFormat === "most-categories") {
    const baseline = poissonBinomialOutcomeValue(impacts.map((impact) => impact.baselineProbability));
    const projected = poissonBinomialOutcomeValue(impacts.map((impact) => impact.projectedProbability));
    return { score: projected - baseline, scoreType: "matchup-probability", impacts };
  }
  return {
    score: impacts.reduce((sum, impact) => sum + impact.delta, 0),
    scoreType: "expected-categories",
    impacts,
  };
};

const RESERVED_POSITIONS = new Set(["BN", "IL", "IL+", "NA"]);

const eligibleFor = (player: FreeAgent) => {
  const positions = player.eligiblePositions?.length
    ? player.eligiblePositions
    : player.position.split(",").map((position) => position.trim());
  return new Set(positions.filter(Boolean));
};

export const canUseSlot = (player: FreeAgent, slot: string) => {
  const eligible = eligibleFor(player);
  if (slot === "Util" || slot === "UTIL") return true;
  if (eligible.has(slot)) return true;
  if (slot === "G") return eligible.has("PG") || eligible.has("SG") || eligible.has("G");
  if (slot === "F") return eligible.has("SF") || eligible.has("PF") || eligible.has("F");
  return false;
};

const activeSlots = (positions: RosterPosition[]) => positions
  .filter(({ position }) => !RESERVED_POSITIONS.has(position.toUpperCase()))
  .flatMap(({ position, count }) => Array.from({ length: count }, () => position));

interface AssignmentPlayer {
  projection: PlayerProjection;
  utility: number;
}

interface Assignment {
  score: number;
  slots: Array<{ slot: string; player: AssignmentPlayer }>;
}

const optimizeLineup = (players: AssignmentPlayer[], slots: string[]): Assignment => {
  const memo = new Map<string, Assignment>();
  const visit = (slotIndex: number, usedMask: number): Assignment => {
    if (slotIndex >= slots.length) return { score: 0, slots: [] };
    const key = `${slotIndex}:${usedMask}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const slot = slots[slotIndex];
    let best = visit(slotIndex + 1, usedMask);
    players.forEach((player, playerIndex) => {
      const bit = 1 << playerIndex;
      if ((usedMask & bit) || !canUseSlot(player.projection.player, slot)) return;
      const tail = visit(slotIndex + 1, usedMask | bit);
      const candidate = {
        score: player.utility + tail.score,
        slots: [{ slot, player }, ...tail.slots],
      };
      if (candidate.score > best.score) best = candidate;
    });
    memo.set(key, best);
    return best;
  };
  return visit(0, 0);
};

export const recommendFreeAgents = (
  freeAgents: FreeAgent[],
  needs: MatchupCategoryRow[],
  options: RecommendationOptions = {},
): Recommendation[] => {
  const playingTeams = new Set(
    [...(options.teamsPlaying ?? [])].map(normalizeTeamAbbreviation),
  );
  const pool = freeAgents.filter((player) => {
    if (confirmedInactive(player)) return false;
    if (!options.strictGameDay) return true;
    return playingTeams.has(normalizeTeamAbbreviation(player.team));
  });
  const allProjectionPlayers = [...pool, ...(options.roster ?? [])];
  const priors = projectionPriors(allProjectionPlayers.length ? allProjectionPlayers : pool);
  const projections = new Map(
    allProjectionPlayers.map((player) => [player.playerKey, projectPlayer(player, priors)]),
  );
  const targetDate = options.targetDate ?? new Date().toISOString().slice(0, 10);
  const scoringFormat = options.scoringFormat ?? "each-category";
  const slots = activeSlots(options.rosterPositions ?? []);
  const scheduleKnown = options.strictGameDay === true;

  const rosterAssignments: AssignmentPlayer[] = (options.roster ?? [])
    .filter((player) => !confirmedInactive(player))
    .map((player) => projections.get(player.playerKey))
    .filter((projection): projection is PlayerProjection => Boolean(projection))
    .filter((projection) => !scheduleKnown || playingTeams.has(normalizeTeamAbbreviation(projection.player.team)))
    .map((projection) => ({
      projection,
      utility: probabilityScore(needs, projection, targetDate, scoringFormat).score,
    }));
  const baselineAssignment = slots.length ? optimizeLineup(rosterAssignments, slots) : undefined;

  return pool
    .map((player): Recommendation => {
      const projection = projections.get(player.playerKey) ?? projectPlayer(player, priors);
      let netProjection = projection;
      let lineupImpact: Recommendation["lineupImpact"] = {
        status: "unknown",
        label: options.lineupAvailable === false ? "Lineup unavailable" : "Full game value",
      };

      if (baselineAssignment && options.lineupAvailable !== false) {
        const candidateAssignmentPlayer: AssignmentPlayer = {
          projection,
          utility: probabilityScore(needs, projection, targetDate, scoringFormat).score,
        };
        const withCandidate = optimizeLineup([...rosterAssignments, candidateAssignmentPlayer], slots);
        const candidateSlot = withCandidate.slots.find(({ player: assigned }) => assigned.projection.player.playerKey === player.playerKey);
        if (!candidateSlot) {
          netProjection = subtractProjection(projection, projection);
          lineupImpact = { status: "not-started", label: "No lineup gain" };
        } else {
          const newKeys = new Set(withCandidate.slots.map(({ player: assigned }) => assigned.projection.player.playerKey));
          const displaced = baselineAssignment.slots.find(({ player: assigned }) => !newKeys.has(assigned.projection.player.playerKey));
          netProjection = subtractProjection(projection, displaced?.player.projection);
          lineupImpact = displaced
            ? {
              status: "replaces",
              label: `Starts over ${displaced.player.projection.player.name}`,
              slot: candidateSlot.slot,
              displacedPlayer: displaced.player.projection.player.name,
            }
            : { status: "fills", label: `Fills ${candidateSlot.slot}`, slot: candidateSlot.slot };
        }
      }

      const scored = probabilityScore(needs, netProjection, targetDate, scoringFormat);
      const sortedImpacts = [...scored.impacts].sort((left, right) => right.delta - left.delta);
      const reason = sortedImpacts
        .filter((impact) => impact.delta > 0.001)
        .slice(0, 3)
        .map((impact) => `${impact.displayName} +${round(impact.delta * 100, 1)}pp`);
      const watchouts = sortedImpacts
        .filter((impact) => impact.delta < -0.001)
        .sort((left, right) => left.delta - right.delta)
        .slice(0, 2)
        .map((impact) => `${impact.displayName} ${round(impact.delta * 100, 1)}pp`);
      const confidence = questionable(player) || projection.sampleSize < 5
        ? "Low"
        : projection.sampleSize >= 20 ? "High" : "Medium";
      return {
        playerKey: player.playerKey,
        name: player.name,
        position: player.position,
        team: normalizeTeamAbbreviation(player.team),
        headshotUrl: player.headshotUrl,
        gameToday: playingTeams.has(normalizeTeamAbbreviation(player.team)),
        gameVerified: scheduleKnown,
        period: player.period,
        projectionBasis: player.statWindows && Object.keys(player.statWindows).length > 1 ? "blended" : "single-window",
        gamesPlayed: projection.sampleSize,
        score: round(scored.score, 4),
        scoreType: scored.scoreType,
        confidence,
        lineupImpact,
        categoryImpacts: sortedImpacts,
        reason,
        watchouts,
        projections: {
          pts: round(projection.rates.pts),
          reb: round(projection.rates.reb),
          ast: round(projection.rates.ast),
          stl: round(projection.rates.stl),
          blk: round(projection.rates.blk),
          threePm: round(projection.rates.threePm),
          turnovers: round(projection.rates.turnovers),
        },
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, options.topN ?? 50);
};
