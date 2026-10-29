import type {
  FreeAgent,
  LeagueCategory,
  LeagueScoringFormat,
  LeagueTeamStats,
  MatchupCategoryRow,
  MatchupTeam,
  Recommendation,
  RecommendationCategoryImpact,
  RosterPlayer,
  RosterPosition,
  ScheduleGame,
  ValidationCoverage,
} from "@/lib/types";
import { MODEL_PARAMETERS, SELECTED_RECOMMENDER } from "@/lib/recommender-model";
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
  const weeklyDeviation = MODEL_PARAMETERS.weeklyResidualStandardDeviation[category] ?? 1;
  const normalizedGap = Math.abs(teamValue - opponentValue) / Math.max(weeklyDeviation, 1e-6);
  const level = normalizedGap < 0.5 ? 1 : normalizedGap < 1 ? 2 : normalizedGap < 2 ? 3 : 4;
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
  categories?: LeagueCategory[];
  standingsTeams?: LeagueTeamStats[];
  selectedTeamKey?: string;
  scheduleGames?: ScheduleGame[];
  onNetProjection?: (key: string, projection: PlayerProjection, usable: boolean) => void;
  now?: Date;
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
  fgPct: ["Field Goal Percentage"],
  ftPct: ["Free Throw Percentage"],
  threePct: ["3-point Percentage"],
};

interface PlayerProjection {
  player: FreeAgent;
  rates: Record<string, number>;
  sampleSize: number;
  extraCounts?: Record<string, number>;
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

const windowWeightsFor = (key: string) => ({
  ...MODEL_PARAMETERS.windowWeights,
  ...(MODEL_PARAMETERS.windowWeightsByStat[key] ?? {}),
});

const rawBlendedRate = (player: FreeAgent, key: string, candidates: string[]) => {
  const windows = windowsFor(player);
  const weights = windowWeightsFor(key);
  let weightedRate = 0;
  let totalWeight = 0;
  for (const period of ["season", "lastmonth", "lastweek"] as const) {
    const stats = windows[period];
    const games = gamesIn(stats);
    if (!stats || games <= 0) continue;
    weightedRate += (firstStatValue(stats, candidates) / games) * weights[period];
    totalWeight += weights[period];
  }
  if (totalWeight > 0) return weightedRate / totalWeight;
  const games = firstStatValue(player.stats, PROJECTION_STATS.gp);
  const value = firstStatValue(player.stats, candidates);
  return games > 0 ? value / games : 0;
};

const rawBlendedRatio = (player: FreeAgent, key: string, candidates: string[]) => {
  const windows = windowsFor(player);
  const weights = windowWeightsFor(key);
  let weighted = 0;
  let totalWeight = 0;
  for (const period of ["season", "lastmonth", "lastweek"] as const) {
    const stats = windows[period];
    const value = firstStatValue(stats, candidates);
    if (!stats || !Number.isFinite(value) || value <= 0) continue;
    weighted += value * weights[period];
    totalWeight += weights[period];
  }
  return totalWeight > 0 ? weighted / totalWeight : firstStatValue(player.stats, candidates);
};

const primaryPosition = (player: FreeAgent) => {
  const positions = player.eligiblePositions?.length
    ? player.eligiblePositions
    : player.position.split(",").map((position) => position.trim());
  return positions.find((position) => ["PG", "SG", "SF", "PF", "C"].includes(position)) ?? "ALL";
};

interface ProjectionPriors {
  overall: Record<string, number>;
  byPosition: Map<string, Record<string, number>>;
}

const averageProjectionRates = (players: FreeAgent[]) => Object.fromEntries(
  Object.entries(PROJECTION_STATS)
    .filter(([key]) => key !== "gp")
    .map(([key, candidates]) => {
      const values = players
        .filter((player) => Math.max(...Object.values(windowsFor(player)).map(gamesIn), 0) > 0)
        .map((player) => (
        key.endsWith("Pct")
          ? rawBlendedRatio(player, key, candidates)
          : rawBlendedRate(player, key, candidates)
        )).filter((value) => {
          if (!Number.isFinite(value) || value < 0) return false;
          const ceilings: Record<string, number> = {
            pts: 70, reb: 35, ast: 25, stl: 10, blk: 10, threePm: 15,
            turnovers: 15, fgm: 30, fga: 50, ftm: 30, fta: 40, threePa: 30,
            fgPct: 1, ftPct: 1, threePct: 1,
          };
          return value <= (ceilings[key] ?? 100);
        });
      return [key, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0];
    }),
) as Record<string, number>;

const projectionPriors = (players: FreeAgent[]): ProjectionPriors => {
  const groups = new Map<string, FreeAgent[]>();
  players.forEach((player) => {
    const position = primaryPosition(player);
    groups.set(position, [...(groups.get(position) ?? []), player]);
  });
  return {
    overall: averageProjectionRates(players),
    byPosition: new Map([...groups].map(([position, group]) => [position, averageProjectionRates(group)])),
  };
};

const addPercentageFallback = (rates: Record<string, number>) => {
  const pairs = [
    { category: "Field Goal Percentage", made: "fgm", attempted: "fga", ratio: "fgPct" },
    { category: "Free Throw Percentage", made: "ftm", attempted: "fta", ratio: "ftPct" },
    { category: "3-point Percentage", made: "threePm", attempted: "threePa", ratio: "threePct" },
  ];
  for (const pair of pairs) {
    if ((rates[pair.attempted] ?? 0) > 0) continue;
    const percentage = rates[pair.ratio] ?? 0;
    if (!(percentage > 0)) continue;
    const attempts = MODEL_PARAMETERS.attemptVolumeFallbackPerGame[pair.category] ?? 1;
    rates[pair.attempted] = attempts;
    rates[pair.made] = percentage * attempts;
  }
};

const projectPlayer = (player: FreeAgent, priors: ProjectionPriors): PlayerProjection => {
  const windows = windowsFor(player);
  const sampleSize = Math.max(...Object.values(windows).map(gamesIn), 0);
  if (sampleSize <= 0) {
    return {
      player,
      rates: Object.fromEntries(Object.keys(PROJECTION_STATS).filter((key) => key !== "gp").map((key) => [key, 0])),
      sampleSize: 0,
    };
  }
  const reliability = sampleSize / (sampleSize + MODEL_PARAMETERS.priorGames);
  const prior = priors.byPosition.get(primaryPosition(player)) ?? priors.overall;
  const rates: Record<string, number> = {};
  for (const [key, candidates] of Object.entries(PROJECTION_STATS)) {
    if (key === "gp") continue;
    const observed = key.endsWith("Pct")
      ? rawBlendedRatio(player, key, candidates)
      : rawBlendedRate(player, key, candidates);
    rates[key] = observed * reliability + (prior[key] ?? priors.overall[key] ?? 0) * (1 - reliability);
  }
  addPercentageFallback(rates);

  for (const { category, made, attempted, ratio } of [
    { category: "Field Goal Percentage", made: "fgm", attempted: "fga", ratio: "fgPct" },
    { category: "Free Throw Percentage", made: "ftm", attempted: "fta", ratio: "ftPct" },
    { category: "3-point Percentage", made: "threePm", attempted: "threePa", ratio: "threePct" },
  ]) {
    const rawAttemptsPerGame = rawBlendedRate(player, attempted, PROJECTION_STATS[attempted]);
    const observedPercentage = rawBlendedRatio(player, ratio, PROJECTION_STATS[ratio]);
    const attemptsPerGame = rawAttemptsPerGame > 0
      ? rawAttemptsPerGame
      : observedPercentage > 0 ? MODEL_PARAMETERS.attemptVolumeFallbackPerGame[category] ?? 1 : 0;
    const observedAttempts = attemptsPerGame * Math.max(sampleSize, 1);
    const observedMade = rawAttemptsPerGame > 0
      ? rawBlendedRate(player, made, PROJECTION_STATS[made]) * Math.max(sampleSize, 1)
      : observedPercentage * observedAttempts;
    const priorPercentage = prior[attempted] > 0
      ? prior[made] / prior[attempted]
      : prior[ratio] ?? priors.overall[ratio] ?? 0;
    const posteriorPercentage = observedAttempts > 0
      ? (observedMade + priorPercentage * MODEL_PARAMETERS.percentagePriorAttempts)
        / (observedAttempts + MODEL_PARAMETERS.percentagePriorAttempts)
      : rates[ratio] ?? priorPercentage;
    rates[ratio] = posteriorPercentage;
    rates[made] = posteriorPercentage * (rates[attempted] ?? 0);
  }
  return { player, rates, sampleSize };
};

const statusCode = (player: FreeAgent) => (player.status ?? "").trim().toUpperCase();
const confirmedInactive = (player: FreeAgent) => new Set(["O", "OUT", "INJ", "IL", "IL+", "NA", "SUSP"]).has(statusCode(player));
const injuryMultiplier = (player: FreeAgent) => {
  const status = statusCode(player);
  if (status === "DTD") return 0.75;
  if (status === "Q" || status === "GTD") return 0.5;
  if (status === "D" || status === "DOUBTFUL") return 0.25;
  return 1;
};

const questionable = (player: FreeAgent) => injuryMultiplier(player) < 1;

export const categoryValidationCoverage = (category: string): ValidationCoverage => {
  if (new Set([
    "Field Goal Percentage", "Free Throw Percentage", "3-point Shots Made", "Points Scored",
    "Total Rebounds", "Assists", "Steals", "Blocked Shots", "Blocks", "Turnovers",
  ]).has(category)) return "validated";
  if (new Set([
    "3-point Percentage", "Offensive Rebounds", "Defensive Rebounds", "Assist/Turnover Ratio", "Double-Doubles",
  ]).has(category)) return "modeled-unvalidated";
  return "unsupported";
};

const confidenceDetails = (projection: PlayerProjection) => {
  const source = projection.player.projectionSource ?? (projection.sampleSize > 0 ? "current-season" : "market-only");
  if (source === "market-only" || projection.sampleSize <= 0) {
    return { score: 15, label: "Market" as const, reasons: ["No valid per-game sample", "Yahoo market data only"] };
  }
  let score = Math.min(85, 30 + projection.sampleSize * 2.5);
  const reasons = [`${projection.sampleSize} valid games`];
  if (source === "previous-season") {
    score = Math.min(score, 69);
    reasons.push("Previous-season projection is capped at Medium");
  } else {
    score += 8;
    reasons.push("Current-season sample");
  }
  const risk = injuryMultiplier(projection.player);
  if (risk < 1) {
    score -= (1 - risk) * 35;
    reasons.push(`Health status ${projection.player.status ?? "uncertain"}`);
    if (risk <= 0.5) score = Math.min(score, 39);
    else score = Math.min(score, 69);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    label: score >= 75 ? "High" as const : score >= 45 ? "Medium" as const : "Low" as const,
    reasons,
  };
};

const aggregateCoverage = (categories: Iterable<string>): ValidationCoverage => {
  const coverage = [...categories].map(categoryValidationCoverage);
  if (!coverage.length || coverage.every((item) => item === "unsupported")) return "unsupported";
  if (coverage.some((item) => item !== "validated")) return "modeled-unvalidated";
  return "validated";
};

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
  if (MODEL_PARAMETERS.probabilityWeekdayScaling === false) return weekly;
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
    return { assists: projection.rates.ast ?? 0, turnovers: projection.rates.turnovers ?? 0 };
  }
  const candidates = COUNT_STATS[category];
  if (!candidates) return undefined;
  if (projection.extraCounts && category in projection.extraCounts) return { value: projection.extraCounts[category] };
  const key = Object.entries(PROJECTION_STATS).find(([, names]) => names === candidates)?.[0];
  if (key) return { value: projection.rates[key] ?? 0 };
  return { value: rawBlendedRate(projection.player, category, candidates) };
};

const subtractProjection = (candidate: PlayerProjection, displaced?: PlayerProjection): PlayerProjection => ({
  player: candidate.player,
  sampleSize: candidate.sampleSize,
  rates: Object.fromEntries(
    Object.keys(candidate.rates).map((key) => [key, candidate.rates[key] - (displaced?.rates[key] ?? 0)]),
  ),
});

// Extra supported counting categories have no canonical rate key; retain their net totals too.
const weeklyCounts = (net: PlayerProjection, displaced: PlayerProjection | undefined, usable: boolean): PlayerProjection => ({
  ...net,
  extraCounts: Object.fromEntries(Object.entries(COUNT_STATS)
    .filter(([, candidates]) => !Object.values(PROJECTION_STATS).includes(candidates))
    .map(([category, candidates]) => [category, !usable ? 0 : rawBlendedRate(net.player, category, candidates)
      - (displaced ? rawBlendedRate(displaced.player, category, candidates) : 0)])),
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
    } else if ("assists" in contribution) {
      const assistsNeed = needs.find((item) => item.category === "Assists");
      const turnoversNeed = needs.find((item) => item.category === "Turnovers");
      const teamAssists = assistsNeed?.teamValue;
      const opponentAssists = assistsNeed?.opponentValue;
      const teamTurnovers = turnoversNeed?.teamValue
        ?? (teamAssists !== null && teamAssists !== undefined && need.teamValue > 0 ? teamAssists / need.teamValue : null);
      const opponentTurnovers = turnoversNeed?.opponentValue
        ?? (opponentAssists !== null && opponentAssists !== undefined && need.opponentValue > 0 ? opponentAssists / need.opponentValue : null);
      if (teamAssists === null || teamAssists === undefined || teamTurnovers === null
        || opponentAssists === null || opponentAssists === undefined || opponentTurnovers === null
        || teamTurnovers <= 0 || opponentTurnovers <= 0) {
        continue;
      }
      baselineGap = teamAssists / teamTurnovers - opponentAssists / opponentTurnovers;
      const nextTurnovers = teamTurnovers + (contribution.turnovers ?? 0);
      if (nextTurnovers <= 0) continue;
      projectedGap = (teamAssists + (contribution.assists ?? 0)) / nextTurnovers - opponentAssists / opponentTurnovers;
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
      coverage: categoryValidationCoverage(need.category),
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

const gameIsLocked = (player: FreeAgent, options: RecommendationOptions) => {
  if (!options.strictGameDay || !options.scheduleGames) return false;
  const team = normalizeTeamAbbreviation(player.team);
  const game = options.scheduleGames.find((item) => item.homeTeam === team || item.awayTeam === team);
  if (!game) return false;
  if (game.status === "in-progress" || game.status === "final") return true;
  if (!game.startTime) return false;
  const start = Date.parse(game.startTime);
  return Number.isFinite(start) && start <= (options.now ?? new Date()).getTime();
};

const availableLineupSlots = (options: RecommendationOptions) => {
  const slots = activeSlots(options.rosterPositions ?? []);
  for (const player of options.roster ?? []) {
    if (!player.selectedPosition || RESERVED_POSITIONS.has(player.selectedPosition.toUpperCase()) || !gameIsLocked(player, options)) continue;
    const exact = slots.findIndex((slot) => slot.toUpperCase() === player.selectedPosition?.toUpperCase());
    const compatible = exact >= 0 ? exact : slots.findIndex((slot) => canUseSlot(player, slot));
    if (compatible >= 0) slots.splice(compatible, 1);
  }
  return slots;
};

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

type ZScoreMode = "baseline" | "blended";

const projectZScorePlayer = (player: FreeAgent, mode: ZScoreMode): PlayerProjection => {
  const windows = windowsFor(player);
  const preferredStats = windows.lastmonth ?? windows.lastweek ?? windows.season ?? player.stats;
  const sampleSize = gamesIn(preferredStats);
  const rates: Record<string, number> = {};
  for (const [key, candidates] of Object.entries(PROJECTION_STATS)) {
    if (key === "gp") continue;
    if (mode === "blended") {
      rates[key] = key.endsWith("Pct")
        ? rawBlendedRatio(player, key, candidates)
        : rawBlendedRate(player, key, candidates);
      continue;
    }
    const value = firstStatValue(preferredStats, candidates);
    rates[key] = sampleSize > 0 ? (key.endsWith("Pct") ? value : value / sampleSize) : 0;
  }
  addPercentageFallback(rates);
  return {
    player,
    rates,
    sampleSize: mode === "blended" ? Math.max(...Object.values(windows).map(gamesIn), 0) : sampleSize,
  };
};

const projectionKeyForCategory = (category: string) => {
  const candidates = COUNT_STATS[category];
  if (!candidates) return undefined;
  return Object.entries(PROJECTION_STATS).find(([, names]) => names === candidates)?.[0];
};

const zScoreMetric = (need: MatchupCategoryRow, projection: PlayerProjection) => {
  const percentage = percentageKeys(need.category);
  if (percentage) {
    const target = need.side === "Lose" || need.side === "Draw"
      ? need.opponentValue ?? 0
      : need.teamValue ?? 0;
    return (projection.rates[percentage.made] ?? 0) - target * (projection.rates[percentage.attempted] ?? 0);
  }
  if (need.category === "Assist/Turnover Ratio") {
    const turnovers = projection.rates.turnovers ?? 0;
    return turnovers > 0 ? (projection.rates.ast ?? 0) / turnovers : projection.rates.ast ?? 0;
  }
  const projectionKey = projectionKeyForCategory(need.category);
  let value = projectionKey
    ? projection.rates[projectionKey] ?? 0
    : rawBlendedRate(projection.player, need.category, COUNT_STATS[need.category] ?? [need.category]);
  if (need.lowerIsBetter) value *= -1;
  return value;
};

interface ZScoreDescriptor {
  need: MatchupCategoryRow;
  mean: number;
  standardDeviation: number;
}

const zScoreDescriptors = (needs: MatchupCategoryRow[], pool: PlayerProjection[]) => needs
  .filter((need) => need.priorityWeight > 0)
  .map((need): ZScoreDescriptor | undefined => {
    const values = pool.map((projection) => zScoreMetric(need, projection)).filter(Number.isFinite);
    if (!values.length) return undefined;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return { need, mean, standardDeviation: Math.sqrt(variance) };
  })
  .filter((descriptor): descriptor is ZScoreDescriptor => Boolean(descriptor));

const zScoreUtility = (projection: PlayerProjection, descriptors: ZScoreDescriptor[]) => {
  const reliability = Math.sqrt(Math.min(Math.max(projection.sampleSize, 0), 8) / 8);
  const reliabilityFactor = 0.75 + 0.25 * reliability;
  const contributions = new Map<string, number>();
  let score = 0;
  for (const descriptor of descriptors) {
    const standardized = descriptor.standardDeviation > 0
      ? (zScoreMetric(descriptor.need, projection) - descriptor.mean) / descriptor.standardDeviation
      : 0;
    const contribution = standardized * descriptor.need.priorityWeight * reliabilityFactor;
    score += contribution;
    contributions.set(descriptor.need.category, contribution);
  }
  return { score, contributions };
};

const zScoreRecommendations = (
  freeAgents: FreeAgent[],
  needs: MatchupCategoryRow[],
  options: RecommendationOptions,
  mode: ZScoreMode,
): Recommendation[] => {
  const playingTeams = new Set([...(options.teamsPlaying ?? [])].map(normalizeTeamAbbreviation));
  const scheduleKnown = options.strictGameDay === true;
  const pool = freeAgents.filter((player) => (
    !confirmedInactive(player)
    && !gameIsLocked(player, options)
    && (!scheduleKnown || playingTeams.has(normalizeTeamAbbreviation(player.team)))
  ));
  const projections = new Map(
    [...pool, ...(options.roster ?? [])].map((player) => [player.playerKey, projectZScorePlayer(player, mode)]),
  );
  const poolProjections = pool.map((player) => projections.get(player.playerKey) as PlayerProjection);
  const descriptors = zScoreDescriptors(needs, poolProjections);
  const slots = availableLineupSlots(options);
  const rosterAssignments: AssignmentPlayer[] = (options.roster ?? [])
    .filter((player) => !confirmedInactive(player))
    .filter((player) => !gameIsLocked(player, options))
    .map((player) => projections.get(player.playerKey))
    .filter((projection): projection is PlayerProjection => Boolean(projection))
    .filter((projection) => !scheduleKnown || playingTeams.has(normalizeTeamAbbreviation(projection.player.team)))
    .map((projection) => ({ projection, utility: zScoreUtility(projection, descriptors).score }));
  const baselineAssignment = slots.length ? optimizeLineup(rosterAssignments, slots) : undefined;

  return pool.map((player): Recommendation => {
    const projection = projections.get(player.playerKey) as PlayerProjection;
    const candidateUtility = zScoreUtility(projection, descriptors);
    let score = candidateUtility.score;
    let contributions = candidateUtility.contributions;
    let lineupImpact: Recommendation["lineupImpact"] = {
      status: "unknown",
      label: options.lineupAvailable === false ? "Lineup unavailable" : "Full game value",
    };

    if (baselineAssignment && options.lineupAvailable !== false) {
      const withCandidate = optimizeLineup([
        ...rosterAssignments,
        { projection, utility: candidateUtility.score },
      ], slots);
      const candidateSlot = withCandidate.slots.find(({ player: assigned }) => assigned.projection.player.playerKey === player.playerKey);
      if (!candidateSlot) {
        score = 0;
        contributions = new Map();
        lineupImpact = { status: "not-started", label: "No lineup gain" };
      } else {
        const newKeys = new Set(withCandidate.slots.map(({ player: assigned }) => assigned.projection.player.playerKey));
        const displaced = baselineAssignment.slots.find(({ player: assigned }) => !newKeys.has(assigned.projection.player.playerKey));
        if (displaced) {
          const displacedUtility = zScoreUtility(displaced.player.projection, descriptors);
          score -= displacedUtility.score;
          contributions = new Map([...contributions].map(([category, value]) => [
            category,
            value - (displacedUtility.contributions.get(category) ?? 0),
          ]));
          lineupImpact = {
            status: "replaces",
            label: `Starts over ${displaced.player.projection.player.name}`,
            slot: candidateSlot.slot,
            displacedPlayer: displaced.player.projection.player.name,
          };
        } else {
          lineupImpact = { status: "fills", label: `Fills ${candidateSlot.slot.toUpperCase()}`, slot: candidateSlot.slot };
        }
      }
    }

    const sortedContributions = [...contributions].sort((left, right) => right[1] - left[1]);
    return {
      playerKey: player.playerKey,
      name: player.name,
      position: player.position,
      team: normalizeTeamAbbreviation(player.team),
      headshotUrl: player.headshotUrl,
      gameToday: playingTeams.has(normalizeTeamAbbreviation(player.team)),
      gameVerified: scheduleKnown,
      period: player.period,
      projectionBasis: mode === "blended" ? "blended" : "single-window",
      gamesPlayed: projection.sampleSize,
      score: round(score * injuryMultiplier(player), 4),
      scoreType: mode === "blended" ? "blended-z-score" : "legacy-z-score",
      rawScore: round(score, 4),
      riskAdjustedScore: round(score * injuryMultiplier(player), 4),
      confidence: confidenceDetails(projection).label,
      confidenceScore: confidenceDetails(projection).score,
      confidenceReasons: confidenceDetails(projection).reasons,
      projectionSource: player.projectionSource ?? (projection.sampleSize > 0 ? "current-season" : "market-only"),
      validationCoverage: aggregateCoverage(contributions.keys()),
      lockVerified: scheduleKnown && options.scheduleGames !== undefined,
      lineupImpact,
      categoryImpacts: [],
      reason: sortedContributions.filter(([, value]) => value > 0.35).slice(0, 3).map(([category]) => category),
      watchouts: [
        ...sortedContributions.filter(([, value]) => value < -0.75).sort((left, right) => left[1] - right[1]).slice(0, 2).map(([category]) => category),
        ...(questionable(player) ? [`${player.status} health adjustment`] : []),
      ],
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
  }).sort((left, right) => right.score - left.score).slice(0, options.topN ?? 50);
};

export const recommendFreeAgentsBaseline = (
  freeAgents: FreeAgent[],
  needs: MatchupCategoryRow[],
  options: RecommendationOptions = {},
) => zScoreRecommendations(freeAgents, needs, options, "baseline");

export const recommendFreeAgentsBlended = (
  freeAgents: FreeAgent[],
  needs: MatchupCategoryRow[],
  options: RecommendationOptions = {},
) => zScoreRecommendations(freeAgents, needs, options, "blended");

export const recommendFreeAgentsProbability = (
  freeAgents: FreeAgent[],
  needs: MatchupCategoryRow[],
  options: RecommendationOptions = {},
): Recommendation[] => {
  const hasProbabilityCategory = needs.some((need) => (
    need.category in PERCENTAGE_CATEGORIES
    || need.category in COUNT_STATS
    || need.category === "Assist/Turnover Ratio"
  ));
  if (!hasProbabilityCategory) {
    return recommendFreeAgentsBlended(freeAgents, needs, options);
  }
  const playingTeams = new Set(
    [...(options.teamsPlaying ?? [])].map(normalizeTeamAbbreviation),
  );
  const pool = freeAgents.filter((player) => {
    if (confirmedInactive(player)) return false;
    if (gameIsLocked(player, options)) return false;
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
  const slots = availableLineupSlots(options);
  const scheduleKnown = options.strictGameDay === true;

  const rosterAssignments: AssignmentPlayer[] = (options.roster ?? [])
    .filter((player) => !confirmedInactive(player))
    .filter((player) => !gameIsLocked(player, options))
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
    let displacedProjection: PlayerProjection | undefined;
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
          displacedProjection = displaced?.player.projection;
          netProjection = subtractProjection(projection, displacedProjection);
          lineupImpact = displaced
            ? {
              status: "replaces",
              label: `Starts over ${displaced.player.projection.player.name}`,
              slot: candidateSlot.slot,
              displacedPlayer: displaced.player.projection.player.name,
            }
            : { status: "fills", label: `Fills ${candidateSlot.slot.toUpperCase()}`, slot: candidateSlot.slot };
        }
      }

      options.onNetProjection?.(player.playerKey, weeklyCounts(netProjection, displacedProjection, lineupImpact.status !== "not-started"), lineupImpact.status !== "not-started");
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
      const confidence = confidenceDetails(projection);
      const rawScore = scored.score;
      const riskAdjustedScore = rawScore * injuryMultiplier(player);
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
        score: round(riskAdjustedScore, 4),
        scoreType: scored.scoreType,
        rawScore: round(rawScore, 4),
        riskAdjustedScore: round(riskAdjustedScore, 4),
        confidence: confidence.label,
        confidenceScore: confidence.score,
        confidenceReasons: confidence.reasons,
        projectionSource: player.projectionSource ?? (projection.sampleSize > 0 ? "current-season" : "market-only"),
        validationCoverage: aggregateCoverage(scored.impacts.map((impact) => impact.category)),
        lockVerified: scheduleKnown && options.scheduleGames !== undefined,
        lineupImpact,
        categoryImpacts: sortedImpacts,
        reason,
        watchouts: [...watchouts, ...(questionable(player) ? [`${player.status} health adjustment`] : [])],
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

interface ObjectiveScore {
  score: number;
  reasons: string[];
  watchouts: string[];
}

const pointsObjective = (projection: PlayerProjection, categories: LeagueCategory[]): ObjectiveScore => {
  const contributions = categories.filter((category) => category.enabled && Number.isFinite(category.scoringModifier)).map((category) => {
    const contribution = categoryContribution(category.name, projection);
    let value = 0;
    if (contribution && "value" in contribution) value = contribution.value ?? 0;
    else if (contribution && "made" in contribution) {
      value = (contribution.attempted ?? 0) > 0 ? (contribution.made ?? 0) / (contribution.attempted ?? 1) : 0;
    } else if (contribution && "assists" in contribution) {
      value = (contribution.turnovers ?? 0) > 0 ? (contribution.assists ?? 0) / (contribution.turnovers ?? 1) : 0;
    }
    return {
      label: category.displayName,
      value: value * (category.scoringModifier ?? 0),
    };
  });
  return {
    score: contributions.reduce((sum, item) => sum + item.value, 0),
    reasons: contributions.filter((item) => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 3).map((item) => `${item.label} +${round(item.value, 1)}`),
    watchouts: contributions.filter((item) => item.value < 0).sort((a, b) => a.value - b.value).slice(0, 2).map((item) => `${item.label} ${round(item.value, 1)}`),
  };
};

const rankPoints = (values: number[], selectedIndex: number, lowerIsBetter: boolean) => {
  const selected = values[selectedIndex];
  if (!Number.isFinite(selected)) return 0;
  const ahead = values.filter((value, index) => index !== selectedIndex && Number.isFinite(value) && (lowerIsBetter ? value < selected : value > selected)).length;
  const tied = values.filter((value) => Number.isFinite(value) && value === selected).length;
  return values.length - ahead - (tied - 1) / 2;
};

const rotoObjective = (
  projection: PlayerProjection,
  categories: LeagueCategory[],
  teams: LeagueTeamStats[],
  selectedTeamKey: string | undefined,
): ObjectiveScore => {
  const selectedIndex = teams.findIndex((team) => team.teamKey === selectedTeamKey);
  if (selectedIndex < 0 || teams.length < 2) return { score: 0, reasons: [], watchouts: ["Standings unavailable"] };
  const gains: Array<{ label: string; gain: number }> = [];
  for (const category of categories.filter((item) => item.enabled)) {
    if (categoryValidationCoverage(category.name) === "unsupported") continue;
    const values = teams.map((team) => toNumber(team.stats[category.statId]));
    if (!values.every(Number.isFinite)) continue;
    const contribution = categoryContribution(category.name, projection);
    if (!contribution) continue;
    const projected = [...values];
    if ("made" in contribution) {
      const selectedRaw = teams[selectedIndex].stats[category.statId];
      const [rawMade, rawAttempts] = splitRatio(selectedRaw);
      const attempts = Number.isFinite(rawAttempts) && rawAttempts > 0 ? rawAttempts : 100;
      const made = Number.isFinite(rawMade) ? rawMade : values[selectedIndex] * attempts;
      projected[selectedIndex] = (made + (contribution.made ?? 0)) / Math.max(1, attempts + (contribution.attempted ?? 0));
    } else if ("assists" in contribution) {
      continue;
    } else {
      projected[selectedIndex] += contribution.value ?? 0;
    }
    const before = rankPoints(values, selectedIndex, LOWER_IS_BETTER.has(category.name));
    const after = rankPoints(projected, selectedIndex, LOWER_IS_BETTER.has(category.name));
    gains.push({ label: category.displayName, gain: after - before });
  }
  return {
    score: gains.reduce((sum, item) => sum + item.gain, 0),
    reasons: gains.filter((item) => item.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3).map((item) => `${item.label} +${round(item.gain, 1)} roto pts`),
    watchouts: gains.filter((item) => item.gain < 0).sort((a, b) => a.gain - b.gain).slice(0, 2).map((item) => `${item.label} ${round(item.gain, 1)} roto pts`),
  };
};

const objectiveRecommendations = (
  freeAgents: FreeAgent[],
  options: RecommendationOptions,
  objective: "points" | "rotisserie",
): Recommendation[] => {
  const playingTeams = new Set([...(options.teamsPlaying ?? [])].map(normalizeTeamAbbreviation));
  const scheduleKnown = options.strictGameDay === true;
  const pool = freeAgents.filter((player) => !confirmedInactive(player) && !gameIsLocked(player, options) && (!scheduleKnown || playingTeams.has(normalizeTeamAbbreviation(player.team))));
  const allPlayers = [...pool, ...(options.roster ?? [])];
  const priors = projectionPriors(allPlayers);
  const projections = new Map(allPlayers.map((player) => [player.playerKey, projectPlayer(player, priors)]));
  const evaluate = (projection: PlayerProjection) => objective === "points"
    ? pointsObjective(projection, options.categories ?? [])
    : rotoObjective(projection, options.categories ?? [], options.standingsTeams ?? [], options.selectedTeamKey);
  const slots = availableLineupSlots(options);
  const rosterAssignments = (options.roster ?? []).filter((player) => !confirmedInactive(player))
    .filter((player) => !gameIsLocked(player, options))
    .map((player) => projections.get(player.playerKey)).filter((projection): projection is PlayerProjection => Boolean(projection))
    .filter((projection) => !scheduleKnown || playingTeams.has(normalizeTeamAbbreviation(projection.player.team)))
    .map((projection) => ({ projection, utility: evaluate(projection).score }));
  const baseline = slots.length ? optimizeLineup(rosterAssignments, slots) : undefined;

  return pool.map((player): Recommendation => {
    const projection = projections.get(player.playerKey) as PlayerProjection;
    let netProjection = projection;
    let displacedProjection: PlayerProjection | undefined;
    let lineupImpact: Recommendation["lineupImpact"] = { status: "unknown", label: options.lineupAvailable === false ? "Lineup unavailable" : "Full game value" };
    if (baseline && options.lineupAvailable !== false) {
      const withCandidate = optimizeLineup([...rosterAssignments, { projection, utility: evaluate(projection).score }], slots);
      const candidateSlot = withCandidate.slots.find(({ player: item }) => item.projection.player.playerKey === player.playerKey);
      if (!candidateSlot) {
        netProjection = subtractProjection(projection, projection);
        lineupImpact = { status: "not-started", label: "No lineup gain" };
      } else {
        const nextKeys = new Set(withCandidate.slots.map(({ player: item }) => item.projection.player.playerKey));
        const displaced = baseline.slots.find(({ player: item }) => !nextKeys.has(item.projection.player.playerKey));
        displacedProjection = displaced?.player.projection;
          netProjection = subtractProjection(projection, displacedProjection);
        lineupImpact = displaced
          ? { status: "replaces", label: `Starts over ${displaced.player.projection.player.name}`, slot: candidateSlot.slot, displacedPlayer: displaced.player.projection.player.name }
          : { status: "fills", label: `Fills ${candidateSlot.slot.toUpperCase()}`, slot: candidateSlot.slot };
      }
    }
      options.onNetProjection?.(player.playerKey, weeklyCounts(netProjection, displacedProjection, lineupImpact.status !== "not-started"), lineupImpact.status !== "not-started");
    const raw = evaluate(netProjection);
    const riskAdjusted = raw.score * injuryMultiplier(player);
    const confidence = confidenceDetails(projection);
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
      score: round(riskAdjusted, 4),
      scoreType: objective === "points" ? "fantasy-points" : "roto-points",
      rawScore: round(raw.score, 4),
      riskAdjustedScore: round(riskAdjusted, 4),
      confidence: confidence.label,
      confidenceScore: confidence.score,
      confidenceReasons: confidence.reasons,
      projectionSource: player.projectionSource ?? (projection.sampleSize > 0 ? "current-season" : "market-only"),
      validationCoverage: aggregateCoverage((options.categories ?? []).map((category) => category.name)),
      lockVerified: scheduleKnown && options.scheduleGames !== undefined,
      lineupImpact,
      categoryImpacts: [],
      reason: raw.reasons,
      watchouts: [...raw.watchouts, ...(questionable(player) ? [`${player.status} health adjustment`] : [])],
      projections: {
        pts: round(projection.rates.pts), reb: round(projection.rates.reb), ast: round(projection.rates.ast),
        stl: round(projection.rates.stl), blk: round(projection.rates.blk), threePm: round(projection.rates.threePm),
        turnovers: round(projection.rates.turnovers),
      },
    };
  }).sort((left, right) => right.score - left.score).slice(0, options.topN ?? 50);
};

export const recommendFreeAgents = (
  freeAgents: FreeAgent[],
  needs: MatchupCategoryRow[],
  options: RecommendationOptions = {},
) => {
  if (options.scoringFormat === "points") return objectiveRecommendations(freeAgents, options, "points");
  if (options.scoringFormat === "rotisserie") return objectiveRecommendations(freeAgents, options, "rotisserie");
  if (SELECTED_RECOMMENDER === "probability") {
    return recommendFreeAgentsProbability(freeAgents, needs, options);
  }
  if (SELECTED_RECOMMENDER === "blended") {
    return recommendFreeAgentsBlended(freeAgents, needs, options);
  }
  return recommendFreeAgentsBaseline(freeAgents, needs, options);
};


// Aggregate daily net projections, never daily scores or category probabilities.
export const recommendRemainingWeek = (
  freeAgents: FreeAgent[], needs: MatchupCategoryRow[], options: RecommendationOptions,
  days: Array<{ date: string; games: ScheduleGame[]; roster: RosterPlayer[] }>,
): Recommendation[] => {
  const totals = new Map<string, { projection: PlayerProjection; usable: number; games: number; row?: Recommendation }>();
  for (const day of days) {
    const dayOptions: RecommendationOptions = { ...options, targetDate: day.date, roster: day.roster,
      scheduleGames: day.games, teamsPlaying: day.games.filter((g) => g.status === "scheduled" && g.startTime && Date.parse(g.startTime) > (options.now ?? new Date()).getTime()).flatMap((g) => [g.homeTeam, g.awayTeam]),
      strictGameDay: true, lineupAvailable: true, topN: freeAgents.length,
      onNetProjection: (key, projection, usable) => {
        if (!availableLineupSlots(dayOptions).length) { usable = false; projection = { ...projection, rates: Object.fromEntries(Object.keys(projection.rates).map((key) => [key, 0])), extraCounts: Object.fromEntries(Object.keys(projection.extraCounts ?? {}).map((key) => [key, 0])) }; }
        const total = totals.get(key) ?? { projection: { ...projection, rates: {}, extraCounts: {} }, usable: 0, games: 0 };
        for (const [stat, value] of Object.entries(projection.rates)) total.projection.rates[stat] = (total.projection.rates[stat] ?? 0) + value;
        for (const [stat, value] of Object.entries(projection.extraCounts ?? {})) total.projection.extraCounts![stat] = (total.projection.extraCounts![stat] ?? 0) + value;
        total.usable += Number(usable); total.games++; totals.set(key, total);
      },
    };
    const rows = options.scoringFormat === "points" || options.scoringFormat === "rotisserie"
      ? objectiveRecommendations(freeAgents, dayOptions, options.scoringFormat)
      : recommendFreeAgentsProbability(freeAgents, needs, dayOptions);
    for (const row of rows) { const total = totals.get(row.playerKey); if (total) total.row ??= row; }
  }
  return [...totals.values()].filter((total) => total.row).map(({ projection, row, usable, games }) => {
    const original = row!;
    const format = options.scoringFormat ?? "each-category";
    const categoryScore = probabilityScore(needs, projection, days[0]?.date ?? options.targetDate ?? "", format);
    const objective = format === "points" ? pointsObjective(projection, options.categories ?? [])
      : format === "rotisserie" ? rotoObjective(projection, options.categories ?? [], options.standingsTeams ?? [], options.selectedTeamKey) : undefined;
    const rawScore = objective?.score ?? categoryScore.score;
    const score = round(rawScore * injuryMultiplier(projection.player), 4);
    const impacts = [...categoryScore.impacts].sort((a, b) => b.delta - a.delta);
    return { ...original, score, rawScore, riskAdjustedScore: score,
      scoreType: format === "points" ? "fantasy-points" as const : format === "rotisserie" ? "roto-points" as const : categoryScore.scoreType,
      remainingGames: games, usableGames: usable, remainingGamesComplete: true,
      categoryImpacts: objective ? [] : impacts,
      reason: objective?.reasons ?? impacts.filter((i) => i.delta > .001).slice(0, 3).map((i) => `${i.displayName} +${round(i.delta * 100, 1)}pp`),
      watchouts: [...(objective?.watchouts ?? impacts.filter((i) => i.delta < -.001).slice(-2).map((i) => `${i.displayName} ${round(i.delta * 100, 1)}pp`)), "整週規則推估，未經整週回測"],
      gameToday: days.some((d) => d.date === options.targetDate && d.games.some((g) => g.homeTeam === original.team || g.awayTeam === original.team)),
      lineupImpact: { status: "unknown" as const, label: `預估可排入 ${usable} 場` },
    };
  }).sort((a, b) => b.score - a.score || a.playerKey.localeCompare(b.playerKey)).slice(0, options.topN ?? 50);
};
