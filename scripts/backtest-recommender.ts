import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import baseArtifact from "../model-artifacts/recommender.json";

const FANTASY_API_BASE = "https://api.sportsdata.io/api/nba/fantasy/json";
const ODDS_API_BASE = "https://api.sportsdata.io/api/nba/odds/json";
const STAT_KEYS = ["fgm", "fga", "ftm", "fta", "threePm", "threePa", "pts", "reb", "oreb", "ast", "stl", "blk", "turnovers", "doubleDoubles"] as const;
const WARMUP_DAYS = 28;
const ROSTER_SIZE = 13;
const ACTIVE_LIMIT = 10;
const REFERENCE_WEEKLY_DEVIATIONS: Record<string, number> = {
  "Field Goal Percentage": 0.025,
  "Free Throw Percentage": 0.035,
  "3-point Shots Made": 8,
  "Points Scored": 45,
  "Total Rebounds": 18,
  "Offensive Rebounds": 8,
  Assists: 14,
  "Assist/Turnover Ratio": 0.3,
  Steals: 5,
  "Blocked Shots": 5,
  Turnovers: 10,
  "Double-Doubles": 2,
};
type StatKey = (typeof STAT_KEYS)[number];
type CountCategory = "threePm" | "pts" | "reb" | "oreb" | "ast" | "stl" | "blk" | "turnovers" | "doubleDoubles";
type EvaluationProfile = "standard-9cat" | "extended-oreb-at-dd";
type Stats = Record<StatKey, number>;
type CandidateName = "baseline" | "blended" | "probability" | "ensemble";
type WindowWeights = { season: number; lastmonth: number; lastweek: number };

interface ProbabilityRankConfig {
  id: string;
  weeklyDeviations: Record<string, number>;
  weekdayScaling: boolean;
  profile: EvaluationProfile;
}

export interface ProviderRow {
  PlayerID?: number;
  Name?: string;
  Position?: string;
  Team?: string;
  Opponent?: string;
  Day?: string;
  DateTime?: string;
  Games?: number;
  Minutes?: number;
  FieldGoalsMade?: number;
  FieldGoalsAttempted?: number;
  FreeThrowsMade?: number;
  FreeThrowsAttempted?: number;
  ThreePointersMade?: number;
  ThreePointersAttempted?: number;
  Points?: number;
  Rebounds?: number;
  OffensiveRebounds?: number;
  Assists?: number;
  Steals?: number;
  BlockedShots?: number;
  Turnovers?: number;
  DoubleDoubles?: number;
  SeasonType?: number;
}

interface ProviderGame {
  Day?: string;
  DateTime?: string;
  SeasonType?: number;
}

interface DownloadCheckpoint {
  completedDates: string[];
  rows: ProviderRow[];
}

export interface GameRow {
  playerId: number;
  name: string;
  position: string;
  team: string;
  opponent: string;
  date: string;
  minutes: number;
  played: boolean;
  stats: Stats;
}

interface FeatureRow extends GameRow {
  season: Stats;
  lastmonth: Stats;
  lastweek: Stats;
  vendor: Stats;
  sampleSize: number;
}

export interface ForecastRow extends GameRow {
  baseline: Stats;
  blended: Stats;
  probability: Stats;
  vendor: Stats;
  ensemble: Stats;
  sampleSize: number;
}

interface RosterAssignment {
  playerId: number;
  team: number;
  value: number;
}

interface ScenarioResult {
  cluster: string;
  baseline: number;
  blended: number;
  probability: number;
  ensemble: number;
}

export const emptyStats = (): Stats => ({
  fgm: 0, fga: 0, ftm: 0, fta: 0, threePm: 0, threePa: 0,
  pts: 0, reb: 0, oreb: 0, ast: 0, stl: 0, blk: 0, turnovers: 0, doubleDoubles: 0,
});

const add = (left: Stats, right: Stats) => Object.fromEntries(
  STAT_KEYS.map((key) => [key, left[key] + right[key]]),
) as Stats;

const subtract = (left: Stats, right: Stats) => Object.fromEntries(
  STAT_KEYS.map((key) => [key, left[key] - right[key]]),
) as Stats;

const mean = (rows: GameRow[]) => {
  if (!rows.length) return emptyStats();
  const total = rows.reduce((sum, row) => add(sum, row.stats), emptyStats());
  return Object.fromEntries(STAT_KEYS.map((key) => [key, total[key] / rows.length])) as Stats;
};

export const normalize = (row: ProviderRow): GameRow | undefined => {
  const playerId = Number(row.PlayerID);
  const date = String(row.Day ?? row.DateTime ?? "").slice(0, 10);
  if (!Number.isFinite(playerId) || !date) return undefined;
  const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const minutes = number(row.Minutes);
  const played = number(row.Games ?? (minutes > 0 ? 1 : 0)) > 0 && minutes > 0;
  return {
    playerId,
    name: String(row.Name ?? `Player ${playerId}`),
    position: String(row.Position ?? "UTIL").split("-")[0].toUpperCase(),
    team: String(row.Team ?? ""),
    opponent: String(row.Opponent ?? ""),
    date,
    minutes,
    played,
    stats: {
      fgm: number(row.FieldGoalsMade),
      fga: number(row.FieldGoalsAttempted),
      ftm: number(row.FreeThrowsMade),
      fta: number(row.FreeThrowsAttempted),
      threePm: number(row.ThreePointersMade),
      threePa: number(row.ThreePointersAttempted),
      pts: number(row.Points),
      reb: number(row.Rebounds),
      oreb: number(row.OffensiveRebounds),
      ast: number(row.Assists),
      stl: number(row.Steals),
      blk: number(row.BlockedShots),
      turnovers: number(row.Turnovers),
      doubleDoubles: number(row.DoubleDoubles),
    },
  };
};

const daysBetween = (left: string, right: string) =>
  Math.floor((Date.parse(right) - Date.parse(left)) / 86_400_000);

const mondayFor = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
};

const previousDate = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

export const buildFeatures = (rows: GameRow[], vendorRows: GameRow[]): FeatureRow[] => {
  const actualByPlayerDate = new Map(rows.map((row) => [`${row.playerId}:${row.date}`, row]));
  const playedByPlayer = new Map<number, GameRow[]>();
  rows.filter((row) => row.played).forEach((row) => {
    playedByPlayer.set(row.playerId, [...(playedByPlayer.get(row.playerId) ?? []), row]);
  });
  playedByPlayer.forEach((history) => history.sort((left, right) => left.date.localeCompare(right.date)));

  return vendorRows
    .filter((row) => row.minutes > 0)
    .sort((left, right) => left.date.localeCompare(right.date))
    .flatMap((vendor) => {
      const history = (playedByPlayer.get(vendor.playerId) ?? []).filter((row) => row.date < vendor.date);
      if (!history.length || daysBetween(history[0].date, vendor.date) < WARMUP_DAYS) return [];
      const monthRows = history.filter((item) => daysBetween(item.date, vendor.date) <= 30);
      const weekRows = history.filter((item) => daysBetween(item.date, vendor.date) <= 7);
      const actual = actualByPlayerDate.get(`${vendor.playerId}:${vendor.date}`) ?? {
        ...vendor,
        minutes: 0,
        played: false,
        stats: emptyStats(),
      };
      return [{
        ...actual,
        season: mean(history),
        lastmonth: mean(monthRows.length ? monthRows : history),
        lastweek: mean(weekRows.length ? weekRows : monthRows.length ? monthRows : history),
        vendor: vendor.stats,
        sampleSize: history.length,
      }];
    });
};

const weightGrid = (): WindowWeights[] => {
  const values: WindowWeights[] = [];
  for (let season = 0; season <= 4; season += 1) {
    for (let lastmonth = 0; lastmonth <= 4 - season; lastmonth += 1) {
      const lastweek = 4 - season - lastmonth;
      values.push({ season: season / 4, lastmonth: lastmonth / 4, lastweek: lastweek / 4 });
    }
  }
  return values;
};

const weightedProjection = (feature: FeatureRow, weightsByStat: Record<StatKey, WindowWeights>) =>
  Object.fromEntries(STAT_KEYS.map((key) => {
    const weights = weightsByStat[key];
    return [key,
      feature.season[key] * weights.season
      + feature.lastmonth[key] * weights.lastmonth
      + feature.lastweek[key] * weights.lastweek,
    ];
  })) as Stats;

const tuneWindowWeights = (validation: FeatureRow[]) => Object.fromEntries(STAT_KEYS.map((key) => {
  const selected = weightGrid().map((weights) => ({
    weights,
    error: validation.reduce((sum, feature) => {
      const prediction = feature.season[key] * weights.season
        + feature.lastmonth[key] * weights.lastmonth
        + feature.lastweek[key] * weights.lastweek;
      return sum + Math.abs(prediction - feature.stats[key]);
    }, 0) / Math.max(1, validation.length),
  })).sort((left, right) => left.error - right.error)[0];
  return [key, selected?.weights ?? baseArtifact.parameters.windowWeights];
})) as Record<StatKey, WindowWeights>;

const positionPriors = (training: GameRow[]) => {
  const grouped = new Map<string, GameRow[]>();
  training.forEach((row) => grouped.set(row.position, [...(grouped.get(row.position) ?? []), row]));
  return {
    overall: mean(training),
    byPosition: new Map([...grouped].map(([position, rows]) => [position, mean(rows)])),
  };
};

const empiricalBayesProjection = (feature: FeatureRow, blended: Stats, priors: ReturnType<typeof positionPriors>) => {
  const prior = priors.byPosition.get(feature.position) ?? priors.overall;
  const reliability = feature.sampleSize / (feature.sampleSize + baseArtifact.parameters.priorGames);
  const projection = Object.fromEntries(STAT_KEYS.map((key) => [
    key,
    blended[key] * reliability + prior[key] * (1 - reliability),
  ])) as Stats;

  for (const [made, attempted] of [["fgm", "fga"], ["ftm", "fta"], ["threePm", "threePa"]] as const) {
    const observedAttempts = blended[attempted] * feature.sampleSize;
    const observedMade = blended[made] * feature.sampleSize;
    const priorPercentage = prior[attempted] > 0 ? prior[made] / prior[attempted] : 0;
    const posteriorPercentage = (observedMade + priorPercentage * baseArtifact.parameters.percentagePriorAttempts)
      / Math.max(1, observedAttempts + baseArtifact.parameters.percentagePriorAttempts);
    projection[made] = posteriorPercentage * projection[attempted];
  }
  return projection;
};

const buildForecasts = (
  features: FeatureRow[],
  weightsByStat: Record<StatKey, WindowWeights>,
  priors: ReturnType<typeof positionPriors>,
  ensembleWeights: Record<StatKey, number> = Object.fromEntries(STAT_KEYS.map((key) => [key, 0])) as Record<StatKey, number>,
): ForecastRow[] => features.map((feature) => {
  const blended = weightedProjection(feature, weightsByStat);
  const probability = empiricalBayesProjection(feature, blended, priors);
  const ensemble = Object.fromEntries(STAT_KEYS.map((key) => [
    key,
    feature.vendor[key] * ensembleWeights[key] + probability[key] * (1 - ensembleWeights[key]),
  ])) as Stats;
  return {
    playerId: feature.playerId,
    name: feature.name,
    position: feature.position,
    team: feature.team,
    opponent: feature.opponent,
    date: feature.date,
    minutes: feature.minutes,
    played: feature.played,
    stats: feature.stats,
    baseline: feature.lastmonth,
    blended,
    probability,
    vendor: feature.vendor,
    ensemble,
    sampleSize: feature.sampleSize,
  };
});

export const tuneEnsembleWeights = (validation: ForecastRow[]) => Object.fromEntries(STAT_KEYS.map((key) => {
  const candidates = [0, 0.25, 0.5, 0.75, 1].map((vendorWeight) => ({
    vendorWeight,
    error: validation.reduce((sum, row) => {
      const prediction = row.vendor[key] * vendorWeight + row.probability[key] * (1 - vendorWeight);
      return sum + Math.abs(prediction - row.stats[key]);
    }, 0) / Math.max(1, validation.length),
  }));
  return [key, candidates.sort((left, right) => left.error - right.error)[0]?.vendorWeight ?? 0];
})) as Record<StatKey, number>;

const categoryScore = (stats: Stats) => ({
  fgPct: stats.fga > 0 ? stats.fgm / stats.fga : 0,
  ftPct: stats.fta > 0 ? stats.ftm / stats.fta : 0,
  threePm: stats.threePm,
  pts: stats.pts,
  reb: stats.reb,
  oreb: stats.oreb,
  ast: stats.ast,
  assistTurnoverRatio: stats.turnovers > 0 ? stats.ast / stats.turnovers : stats.ast,
  stl: stats.stl,
  blk: stats.blk,
  turnovers: stats.turnovers,
  doubleDoubles: stats.doubleDoubles,
});

const categoriesForProfile = (profile: EvaluationProfile) => profile === "extended-oreb-at-dd"
  ? ["fgPct", "ftPct", "threePm", "pts", "reb", "oreb", "ast", "assistTurnoverRatio", "stl", "blk", "turnovers", "doubleDoubles"] as const
  : ["fgPct", "ftPct", "threePm", "pts", "reb", "ast", "stl", "blk", "turnovers"] as const;

const categoryWins = (team: Stats, opponent: Stats, profile: EvaluationProfile) => {
  const left = categoryScore(team);
  const right = categoryScore(opponent);
  return categoriesForProfile(profile).reduce((sum, key) => {
    if (key === "turnovers") return sum + (left[key] < right[key] ? 1 : left[key] === right[key] ? 0.5 : 0);
    return sum + (left[key] > right[key] ? 1 : left[key] === right[key] ? 0.5 : 0);
  }, 0);
};

const erf = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
};

const normalCdf = (value: number) => 0.5 * (1 + erf(value / Math.sqrt(2)));

type CategoryScoreKey = keyof ReturnType<typeof categoryScore>;

const categoryPriority = (key: CategoryScoreKey, team: Stats, opponent: Stats) => {
  const current = categoryScore(team)[key];
  const other = categoryScore(opponent)[key];
  if (current === other) return 3.25;
  const lowerIsBetter = key === "turnovers";
  const winning = lowerIsBetter ? current < other : current > other;
  const differenceRatio = Math.abs(current - other) / Math.max(Math.abs(current), 1);
  const thresholds = key === "fgPct" || key === "ftPct" ? [0.05, 0.1, 0.15] : [0.1, 0.2, 0.3];
  const level = differenceRatio < thresholds[0] ? 1 : differenceRatio < thresholds[1] ? 2 : differenceRatio < thresholds[2] ? 3 : 4;
  return winning
    ? ({ 1: 1.1, 2: 0.35, 3: 0, 4: 0 })[level]
    : ({ 1: 4, 2: 2.75, 3: 1.25, 4: 0.35 })[level];
};

const zScoreMetric = (key: CategoryScoreKey, projection: Stats, team: Stats, opponent: Stats) => {
  const current = categoryScore(team);
  const other = categoryScore(opponent);
  if (key === "fgPct") {
    const target = current.fgPct <= other.fgPct ? other.fgPct : current.fgPct;
    return projection.fgm - target * projection.fga;
  }
  if (key === "ftPct") {
    const target = current.ftPct <= other.ftPct ? other.ftPct : current.ftPct;
    return projection.ftm - target * projection.fta;
  }
  if (key === "assistTurnoverRatio") {
    const before = team.turnovers > 0 ? team.ast / team.turnovers : team.ast;
    const afterTurnovers = team.turnovers + projection.turnovers;
    const after = afterTurnovers > 0 ? (team.ast + projection.ast) / afterTurnovers : team.ast + projection.ast;
    return after - before;
  }
  const statKey = key as CountCategory;
  const value = projection[statKey];
  return key === "turnovers" ? -value : value;
};

export const zScoreRank = (
  candidates: ForecastRow[],
  model: CandidateName,
  team: Stats,
  opponent: Stats,
  profile: EvaluationProfile = "standard-9cat",
) => {
  const categories: CategoryScoreKey[] = [...categoriesForProfile(profile)];
  const descriptors = categories.map((key) => {
    const values = candidates.map((row) => zScoreMetric(key, row[model], team, opponent));
    const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length));
    return { key, average, deviation, weight: categoryPriority(key, team, opponent) };
  }).filter((descriptor) => descriptor.weight > 0);

  return [...candidates].sort((left, right) => {
    const utility = (row: ForecastRow) => {
      const reliability = 0.75 + 0.25 * Math.sqrt(Math.min(Math.max(row.sampleSize, 0), 8) / 8);
      return descriptors.reduce((sum, descriptor) => {
        const value = zScoreMetric(descriptor.key, row[model], team, opponent);
        const standardized = descriptor.deviation > 0 ? (value - descriptor.average) / descriptor.deviation : 0;
        return sum + standardized * descriptor.weight * reliability;
      }, 0);
    };
    return utility(right) - utility(left);
  })[0];
};

const probabilityRank = (
  projection: Stats,
  team: Stats,
  opponent: Stats,
  date: string,
  config: ProbabilityRankConfig,
) => {
  const before = categoryScore(team);
  const after = categoryScore(add(team, projection));
  const other = categoryScore(opponent);
  const categoryNames = {
    fgPct: "Field Goal Percentage",
    ftPct: "Free Throw Percentage",
    threePm: "3-point Shots Made",
    pts: "Points Scored",
    reb: "Total Rebounds",
    oreb: "Offensive Rebounds",
    ast: "Assists",
    assistTurnoverRatio: "Assist/Turnover Ratio",
    stl: "Steals",
    blk: "Blocked Shots",
    turnovers: "Turnovers",
    doubleDoubles: "Double-Doubles",
  } as const;
  const day = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const remainingFraction = Math.max(1 / 7, (7 - day) / 7);
  const deviations = Object.fromEntries(Object.entries(categoryNames).map(([key, category]) => [
    key,
    config.weekdayScaling
      ? Math.max(
        (config.weeklyDeviations[category] ?? 1) * 0.28,
        (config.weeklyDeviations[category] ?? 1) * Math.sqrt(remainingFraction),
      )
      : config.weeklyDeviations[category] ?? 1,
  ])) as Record<keyof typeof categoryNames, number>;
  return (categoriesForProfile(config.profile) as readonly (keyof typeof deviations)[]).reduce((sum, key) => {
    const direction = key === "turnovers" ? -1 : 1;
    const baseline = normalCdf(direction * (before[key] - other[key]) / deviations[key]);
    const projected = normalCdf(direction * (after[key] - other[key]) / deviations[key]);
    return sum + projected - baseline;
  }, 0);
};

const fantasyValue = (stats: Stats) =>
  stats.pts + stats.reb * 1.2 + stats.ast * 1.5 + stats.stl * 3 + stats.blk * 3 + stats.threePm - stats.turnovers;

const seededRandom = (seed: number) => () => {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  return seed / 4_294_967_296;
};

const rosteredPlayers = (training: GameRow[], teamCount: number): RosterAssignment[] => {
  const grouped = new Map<number, GameRow[]>();
  training.forEach((row) => grouped.set(row.playerId, [...(grouped.get(row.playerId) ?? []), row]));
  const random = seededRandom(20260716 + teamCount);
  return [...grouped.entries()]
    .map(([playerId, rows]) => ({ playerId, value: fantasyValue(mean(rows)), jitter: random() / 1000 }))
    .sort((left, right) => right.value + right.jitter - left.value - left.jitter)
    .slice(0, teamCount * ROSTER_SIZE)
    .map(({ playerId, value }, index) => {
      const round = Math.floor(index / teamCount);
      const offset = index % teamCount;
      return { playerId, value, team: round % 2 === 0 ? offset : teamCount - 1 - offset };
    });
};

const activeRows = (rows: GameRow[], assignments: RosterAssignment[], team: number, start: string, end: string) => {
  const values = new Map(assignments.filter((item) => item.team === team).map((item) => [item.playerId, item.value]));
  const byDate = new Map<string, GameRow[]>();
  rows.filter((row) => row.date >= start && row.date <= end && values.has(row.playerId)).forEach((row) => {
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  });
  return [...byDate.values()].flatMap((day) => day
    .sort((left, right) => (values.get(right.playerId) ?? 0) - (values.get(left.playerId) ?? 0))
    .slice(0, ACTIVE_LIMIT));
};

const aggregate = (rows: GameRow[]) => rows.reduce((sum, row) => add(sum, row.stats), emptyStats());

const weakestActive = (rows: GameRow[], assignments: RosterAssignment[], team: number, date: string) => {
  const values = new Map(assignments.filter((item) => item.team === team).map((item) => [item.playerId, item.value]));
  return rows.filter((row) => row.date === date && values.has(row.playerId))
    .sort((left, right) => (values.get(right.playerId) ?? 0) - (values.get(left.playerId) ?? 0))
    .slice(0, ACTIVE_LIMIT)
    .at(-1);
};

const simulate = (
  rows: GameRow[],
  forecasts: ForecastRow[],
  trainingEnd: string,
  heldoutStart: string,
  rankConfig: ProbabilityRankConfig,
  evaluationEnd?: string,
) => {
  const training = rows.filter((row) => row.played && row.date <= trainingEnd);
  const heldoutDates = [...new Set(forecasts.filter((row) => row.date >= heldoutStart).map((row) => row.date))].sort();
  const forecastByDate = new Map<string, ForecastRow[]>();
  forecasts.forEach((row) => forecastByDate.set(row.date, [...(forecastByDate.get(row.date) ?? []), row]));
  const results: ScenarioResult[] = [];

  for (const teamCount of [8, 10, 12]) {
    const assignments = rosteredPlayers(training, teamCount);
    const rostered = new Set(assignments.map(({ playerId }) => playerId));
    for (const date of heldoutDates) {
      if ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 === 0) continue;
      const week = mondayFor(date);
      const weekEnd = new Date(`${week}T12:00:00Z`);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      const end = weekEnd.toISOString().slice(0, 10);
      if (evaluationEnd && end > evaluationEnd) continue;
      const candidates = (forecastByDate.get(date) ?? []).filter((row) => !rostered.has(row.playerId));
      if (candidates.length < 5) continue;

      for (let team = 0; team + 1 < teamCount; team += 2) {
        const beforeDate = previousDate(date);
        const currentTeam = aggregate(activeRows(rows, assignments, team, week, beforeDate));
        const currentOpponent = aggregate(activeRows(rows, assignments, team + 1, week, beforeDate));
        const finalTeam = aggregate(activeRows(rows, assignments, team, week, end));
        const finalOpponent = aggregate(activeRows(rows, assignments, team + 1, week, end));
        const displaced = weakestActive(rows, assignments, team, date);
        const displacedForecast = (forecastByDate.get(date) ?? []).find((row) => row.playerId === displaced?.playerId);
        const noMove = categoryWins(finalTeam, finalOpponent, rankConfig.profile);
        const selected = Object.fromEntries(([
          "baseline", "blended", "probability", "ensemble",
        ] as CandidateName[]).map((model) => {
          if (model === "baseline" || model === "blended") {
            return [model, zScoreRank(candidates, model, currentTeam, currentOpponent, rankConfig.profile)];
          }
          const displacedProjection = displacedForecast?.[model] ?? emptyStats();
          const ranked = [...candidates].sort((left, right) => (
            probabilityRank(subtract(right[model], displacedProjection), currentTeam, currentOpponent, date, rankConfig)
            - probabilityRank(subtract(left[model], displacedProjection), currentTeam, currentOpponent, date, rankConfig)
          ));
          return [model, ranked[0]];
        })) as Record<CandidateName, ForecastRow>;
        results.push({
          cluster: `${teamCount}:${week}`,
          baseline: categoryWins(add(finalTeam, subtract(selected.baseline.stats, displaced?.stats ?? emptyStats())), finalOpponent, rankConfig.profile) - noMove,
          blended: categoryWins(add(finalTeam, subtract(selected.blended.stats, displaced?.stats ?? emptyStats())), finalOpponent, rankConfig.profile) - noMove,
          probability: categoryWins(add(finalTeam, subtract(selected.probability.stats, displaced?.stats ?? emptyStats())), finalOpponent, rankConfig.profile) - noMove,
          ensemble: categoryWins(add(finalTeam, subtract(selected.ensemble.stats, displaced?.stats ?? emptyStats())), finalOpponent, rankConfig.profile) - noMove,
        });
      }
    }
  }
  return results;
};

const normalizedMae = (forecasts: ForecastRow[], model: CandidateName) => {
  const errors = STAT_KEYS.map((key) => {
    const scale = forecasts.reduce((sum, row) => sum + Math.abs(row.stats[key]), 0) / Math.max(1, forecasts.length);
    const mae = forecasts.reduce((sum, row) => sum + Math.abs(row[model][key] - row.stats[key]), 0) / Math.max(1, forecasts.length);
    return scale > 0 ? mae / scale : 0;
  });
  return errors.reduce((sum, value) => sum + value, 0) / errors.length;
};

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
};

const calibrateProductionParameters = (validation: ForecastRow[], training: GameRow[]) => {
  const weeklyScale = Math.sqrt(ACTIVE_LIMIT * 7);
  const countMappings: Array<[string, StatKey]> = [
    ["Points Scored", "pts"],
    ["Total Rebounds", "reb"],
    ["Offensive Rebounds", "oreb"],
    ["Assists", "ast"],
    ["Steals", "stl"],
    ["Blocked Shots", "blk"],
    ["Blocks", "blk"],
    ["3-point Shots Made", "threePm"],
    ["3-point Shots Attempted", "threePa"],
    ["Turnovers", "turnovers"],
    ["Double-Doubles", "doubleDoubles"],
    ["Field Goals Made", "fgm"],
    ["Field Goals Attempted", "fga"],
    ["Free Throws Made", "ftm"],
    ["Free Throws Attempted", "fta"],
  ];
  const weeklyResidualStandardDeviation = {
    ...baseArtifact.parameters.weeklyResidualStandardDeviation,
  } as Record<string, number>;
  countMappings.forEach(([category, key]) => {
    const deviation = standardDeviation(validation.map((row) => row.stats[key] - row.probability[key])) * weeklyScale;
    if (Number.isFinite(deviation) && deviation > 0) weeklyResidualStandardDeviation[category] = deviation;
  });
  for (const [category, made, attempted] of [
    ["Field Goal Percentage", "fgm", "fga"],
    ["Free Throw Percentage", "ftm", "fta"],
    ["3-point Percentage", "threePm", "threePa"],
  ] as const) {
    const errors = validation.flatMap((row) => {
      if (row.stats[attempted] <= 0 || row.probability[attempted] <= 0) return [];
      return [row.stats[made] / row.stats[attempted] - row.probability[made] / row.probability[attempted]];
    });
    const deviation = standardDeviation(errors) / weeklyScale;
    if (Number.isFinite(deviation) && deviation > 0) weeklyResidualStandardDeviation[category] = deviation;
  }
  const assistTurnoverErrors = validation.flatMap((row) => {
    if (row.stats.turnovers <= 0 || row.probability.turnovers <= 0) return [];
    return [row.stats.ast / row.stats.turnovers - row.probability.ast / row.probability.turnovers];
  });
  const assistTurnoverDeviation = standardDeviation(assistTurnoverErrors) / weeklyScale;
  if (Number.isFinite(assistTurnoverDeviation) && assistTurnoverDeviation > 0) {
    weeklyResidualStandardDeviation["Assist/Turnover Ratio"] = assistTurnoverDeviation;
  }

  const trainingRates = mean(training);
  const attemptVolumeFallbackPerGame = {
    "Field Goal Percentage": trainingRates.fga,
    "Free Throw Percentage": trainingRates.fta,
    "3-point Percentage": trainingRates.threePa,
  };
  const averageWeeklyAttempts = Object.fromEntries(Object.entries(attemptVolumeFallbackPerGame).map(
    ([category, attempts]) => [category, attempts * ACTIVE_LIMIT * 7],
  ));
  return { weeklyResidualStandardDeviation, attemptVolumeFallbackPerGame, averageWeeklyAttempts };
};

const bootstrapInterval = (results: ScenarioResult[], candidate: Exclude<CandidateName, "baseline">) => {
  const clusters = [...new Set(results.map((result) => result.cluster))];
  if (!clusters.length) return { lower: 0, upper: 0 };
  const random = seededRandom(20260716);
  const samples = Array.from({ length: 2000 }, () => {
    const selected = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]);
    const values = selected.flatMap((cluster) => results.filter((result) => result.cluster === cluster));
    return values.reduce((sum, result) => sum + result[candidate] - result.baseline, 0) / Math.max(1, values.length);
  }).sort((left, right) => left - right);
  return { lower: samples[50] ?? 0, upper: samples[1949] ?? 0 };
};

export const passesEvidenceGate = (
  candidateError: number,
  baselineError: number,
  interval: { lower: number; upper: number },
) => interval.lower > 0 && candidateError <= baselineError * 1.02;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fetchSportsData = async <T>(url: string, apiKey: string): Promise<T> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    });
    if (response.ok) return response.json() as Promise<T>;
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await wait(1_000 * 2 ** attempt);
      continue;
    }
    throw new Error(`SportsDataIO returned ${response.status} for ${new URL(url).pathname}: ${await response.text()}`);
  }
  throw new Error(`SportsDataIO request retries were exhausted for ${new URL(url).pathname}.`);
};

const discoveryLabDate = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  const month = value.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  return `${value.getUTCFullYear()}-${month}-${String(value.getUTCDate()).padStart(2, "0")}`;
};

const fetchRows = async (season: string, apiKey: string, kind: "actual" | "projection" = "actual") => {
  const cacheDir = path.resolve(".cache/recommender");
  const suffix = kind === "actual" ? "" : ".projections";
  const cachePath = path.join(cacheDir, `${season}${suffix}.json`);
  const checkpointPath = path.join(cacheDir, `${season}${suffix}.partial.json`);
  await mkdir(cacheDir, { recursive: true });
  if (existsSync(cachePath)) return JSON.parse(await readFile(cachePath, "utf8")) as ProviderRow[];

  const apiSeason = season.replace(/REG$/i, "");
  const games = await fetchSportsData<ProviderGame[]>(`${ODDS_API_BASE}/Games/${apiSeason}`, apiKey);
  const dates = [...new Set(games
    .filter((game) => Number(game.SeasonType ?? 1) === 1)
    .map((game) => String(game.Day ?? game.DateTime ?? "").slice(0, 10))
    .filter(Boolean))].sort();
  if (!dates.length) throw new Error(`SportsDataIO returned no regular-season game dates for ${apiSeason}.`);

  const checkpoint = existsSync(checkpointPath)
    ? JSON.parse(await readFile(checkpointPath, "utf8")) as DownloadCheckpoint
    : { completedDates: [], rows: [] };
  const completedDates = new Set(checkpoint.completedDates);
  const payload = [...checkpoint.rows];
  const remainingDates = dates.filter((date) => !completedDates.has(date));
  const endpoint = kind === "actual" ? "PlayerGameStatsByDate" : "PlayerGameProjectionStatsByDate";

  for (let start = 0; start < remainingDates.length; start += 4) {
    const batch = remainingDates.slice(start, start + 4);
    const batches = await Promise.all(batch.map(async (date) => ({
      date,
      rows: await fetchSportsData<ProviderRow[]>(
        `${FANTASY_API_BASE}/${endpoint}/${discoveryLabDate(date)}`,
        apiKey,
      ),
    })));
    for (const result of batches) {
      payload.push(...result.rows.filter((row) => Number(row.SeasonType ?? 1) === 1));
      completedDates.add(result.date);
    }
    await writeFile(checkpointPath, JSON.stringify({ completedDates: [...completedDates], rows: payload }), "utf8");
    process.stderr.write(`Downloaded ${completedDates.size}/${dates.length} ${kind} regular-season dates.\n`);
  }

  await writeFile(cachePath, JSON.stringify(payload), "utf8");
  return payload;
};

const main = async () => {
  const seasonsArgument = process.argv.find((argument) => argument.startsWith("--seasons="))?.split("=")[1];
  const singleSeason = process.argv.find((argument) => argument.startsWith("--season="))?.split("=")[1];
  const seasons = (seasonsArgument?.split(",") ?? [singleSeason ?? "2026REG"]).map((item) => item.trim()).filter(Boolean);
  const season = seasons.join(",");
  const apiKey = process.env.SPORTSDATAIO_API_KEY ?? "";
  const cacheDir = path.resolve(".cache/recommender");
  const hasCachedInputs = seasons.every((item) => existsSync(path.join(cacheDir, `${item}.json`))
    && existsSync(path.join(cacheDir, `${item}.projections.json`)));
  if (!apiKey && !hasCachedInputs) {
    throw new Error("SPORTSDATAIO_API_KEY is required when historical backtest inputs are not cached.");
  }
  const rows = (await Promise.all(seasons.map((item) => fetchRows(item, apiKey))))
    .flat().map(normalize).filter((row): row is GameRow => Boolean(row));
  const vendorRows = (await Promise.all(seasons.map((item) => fetchRows(item, apiKey, "projection"))))
    .flat().map(normalize).filter((row): row is GameRow => Boolean(row));
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  if (dates.length < 60) throw new Error(`Only ${dates.length} game dates were returned; a complete regular season is required.`);
  const trainingEnd = dates[Math.floor(dates.length * 0.6)];
  const validationStart = dates[Math.floor(dates.length * 0.6) + 1];
  const heldoutStart = dates[Math.floor(dates.length * 0.8)];
  const validationEnd = previousDate(heldoutStart);
  const features = buildFeatures(rows, vendorRows);
  const validation = features.filter((row) => row.date > trainingEnd && row.date < heldoutStart);
  const weightsByStat = tuneWindowWeights(validation);
  const priors = positionPriors(rows.filter((row) => row.played && row.date <= trainingEnd));
  const provisionalForecasts = buildForecasts(features, weightsByStat, priors);
  const ensembleWeightsByStat = tuneEnsembleWeights(
    provisionalForecasts.filter((row) => row.date > trainingEnd && row.date < heldoutStart),
  );
  const forecasts = buildForecasts(features, weightsByStat, priors, ensembleWeightsByStat);
  const validationForecasts = forecasts.filter((row) => row.date > trainingEnd && row.date < heldoutStart);
  const heldout = forecasts.filter((row) => row.date >= heldoutStart);
  const calibratedParameters = calibrateProductionParameters(
    validationForecasts,
    rows.filter((row) => row.played && row.date <= trainingEnd),
  );
  const rankConfigs: ProbabilityRankConfig[] = [
    {
      id: "calibrated-dynamic",
      weeklyDeviations: calibratedParameters.weeklyResidualStandardDeviation,
      weekdayScaling: true,
      profile: "standard-9cat",
    },
    {
      id: "calibrated-static",
      weeklyDeviations: calibratedParameters.weeklyResidualStandardDeviation,
      weekdayScaling: false,
      profile: "standard-9cat",
    },
    { id: "reference-dynamic", weeklyDeviations: REFERENCE_WEEKLY_DEVIATIONS, weekdayScaling: true, profile: "standard-9cat" },
    { id: "reference-static", weeklyDeviations: REFERENCE_WEEKLY_DEVIATIONS, weekdayScaling: false, profile: "standard-9cat" },
  ];
  const validationRankCalibration = rankConfigs.map((config) => {
    const results = simulate(rows, forecasts, trainingEnd, validationStart, config, validationEnd);
    const interval = bootstrapInterval(results, "probability");
    const realizedGain = results.reduce((sum, result) => sum + result.probability, 0) / Math.max(1, results.length);
    return { config, scenarios: results.length, realizedGain, interval };
  });
  const selectedRankCalibration = [...validationRankCalibration].sort((left, right) => (
    right.interval.lower - left.interval.lower || right.realizedGain - left.realizedGain
  ))[0];
  if (!selectedRankCalibration) throw new Error("No probability ranking calibration could be evaluated.");
  const scenarios = simulate(
    rows,
    forecasts,
    trainingEnd,
    heldoutStart,
    selectedRankCalibration.config,
  );
  const extendedScenarios = simulate(rows, forecasts, trainingEnd, heldoutStart, {
    ...selectedRankCalibration.config,
    id: `${selectedRankCalibration.config.id}-extended`,
    profile: "extended-oreb-at-dd",
  });
  if (!heldout.length || !scenarios.length) throw new Error("The held-out partition produced no evaluable forecasts or matchup scenarios.");

  const models: CandidateName[] = ["baseline", "blended", "probability", "ensemble"];
  const projectionError = Object.fromEntries(models.map(
    (model) => [model, normalizedMae(heldout, model)],
  )) as Record<CandidateName, number>;
  const realizedCategoryGain = Object.fromEntries(models.map((model) => [
    model,
    scenarios.reduce((sum, result) => sum + result[model], 0) / scenarios.length,
  ])) as Record<CandidateName, number>;
  const confidenceIntervalsVersusBaseline = {
    blended: bootstrapInterval(scenarios, "blended"),
    probability: bootstrapInterval(scenarios, "probability"),
    ensemble: bootstrapInterval(scenarios, "ensemble"),
  };
  const productionCandidates = ["blended", "probability"] as const;
  const eligible = productionCandidates.filter((model) => passesEvidenceGate(
    projectionError[model],
    projectionError.baseline,
    confidenceIntervalsVersusBaseline[model],
  ));
  let selectedModel: CandidateName = "baseline";
  if (eligible.length) {
    selectedModel = eligible.sort(
      (left, right) => realizedCategoryGain[right] - realizedCategoryGain[left],
    )[0];
  }
  const report = {
    generatedAt: new Date().toISOString(),
    season,
    provider: "SportsDataIO Discovery Lab",
    status: "completed",
    warmupDays: WARMUP_DAYS,
    split: { trainingEnd, validationStart, heldoutStart },
    leagueSizes: [8, 10, 12],
    rosterSize: ROSTER_SIZE,
    activeLimit: ACTIVE_LIMIT,
    rows: rows.length,
    vendorProjectionRows: vendorRows.length,
    validationForecasts: validationForecasts.length,
    heldoutForecasts: heldout.length,
    scenarios: scenarios.length,
    evaluationProfiles: {
      "standard-9cat": { scenarios: scenarios.length, categories: ["FG%", "FT%", "3PM", "PTS", "REB", "AST", "STL", "BLK", "TO"] },
      "extended-oreb-at-dd": {
        scenarios: extendedScenarios.length,
        categories: ["FG%", "FT%", "3PM", "PTS", "REB", "OREB", "AST", "A/T", "STL", "BLK", "TO", "DD"],
        realizedCategoryGain: Object.fromEntries(models.map((model) => [
          model,
          extendedScenarios.reduce((sum, result) => sum + result[model], 0) / Math.max(1, extendedScenarios.length),
        ])),
      },
    },
    projectionError,
    realizedCategoryGain,
    confidenceIntervalsVersusBaseline,
    methodology: {
      candidateUniverse: "Historical pregame projections with projected minutes above zero; unexpected DNP outcomes remain zero-valued results.",
      baselineRanking: "Production-parity matchup-priority Z-score with sample-size reliability.",
      tuning: "Window and ensemble weights are fitted on validation dates only.",
      productionCandidates,
      researchOnlyCandidates: ["ensemble"],
    },
    probabilityRankCalibration: {
      selected: selectedRankCalibration.config.id,
      validation: validationRankCalibration.map(({ config, ...metrics }) => ({ id: config.id, ...metrics })),
    },
    ensembleWeightsByStat,
    evidenceGate: "95% clustered-bootstrap lower bound above zero and projection NMAE within 2% of baseline",
    selectedModel,
  };
  const baseParameters = Object.fromEntries(
    Object.entries(baseArtifact.parameters).filter(([key]) => (
      key !== "ensembleWeightsByStat" && key !== "probabilityRankMode"
    )),
  );
  const artifact = {
    ...baseArtifact,
    schemaVersion: 2,
    modelVersion: "2.0.0",
    validationLabel: `${season} single-season validation`,
    validationCoverage: {
      validated: ["FG%", "FT%", "3PM", "PTS", "REB", "AST", "STL", "BLK", "TO"],
      modeledUnvalidated: ["OREB", "A/T", "DD", "3P%", "DREB"],
      unsupported: "All other custom categories",
    },
    generatedAt: report.generatedAt,
    status: "completed",
    selectedModel,
    parameters: {
      ...baseParameters,
      windowWeightsByStat: weightsByStat,
      ...calibratedParameters,
      weeklyResidualStandardDeviation: {
        ...calibratedParameters.weeklyResidualStandardDeviation,
        ...selectedRankCalibration.config.weeklyDeviations,
      },
      probabilityWeekdayScaling: selectedRankCalibration.config.weekdayScaling,
    },
    metrics: report,
    message: selectedModel === "baseline"
      ? "No candidate cleared the held-out evidence gate; the legacy production scorer is retained."
      : `${selectedModel} cleared the held-out evidence gate and is promoted for production.`,
  };
  await mkdir(path.resolve("reports"), { recursive: true });
  await mkdir(path.resolve("model-artifacts"), { recursive: true });
  await writeFile(path.resolve("reports/recommender-backtest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.resolve("model-artifacts/recommender.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
