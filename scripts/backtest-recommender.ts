import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const API_BASE = "https://api.sportsdata.io/v3/nba/stats/json";
const STAT_KEYS = ["fgm", "fga", "ftm", "fta", "threePm", "pts", "reb", "ast", "stl", "blk", "turnovers"] as const;
const COUNT_CATEGORIES = ["threePm", "pts", "reb", "ast", "stl", "blk", "turnovers"] as const;
type StatKey = (typeof STAT_KEYS)[number];
type Stats = Record<StatKey, number>;
type CandidateName = "baseline" | "blended" | "probability";

interface ProviderRow {
  PlayerID?: number;
  Name?: string;
  Day?: string;
  DateTime?: string;
  Games?: number;
  Minutes?: number;
  FieldGoalsMade?: number;
  FieldGoalsAttempted?: number;
  FreeThrowsMade?: number;
  FreeThrowsAttempted?: number;
  ThreePointersMade?: number;
  Points?: number;
  Rebounds?: number;
  Assists?: number;
  Steals?: number;
  BlockedShots?: number;
  Turnovers?: number;
}

interface GameRow {
  playerId: number;
  name: string;
  date: string;
  stats: Stats;
}

interface ForecastRow extends GameRow {
  baseline: Stats;
  blended: Stats;
  probability: Stats;
  sampleSize: number;
}

interface ScenarioResult {
  cluster: string;
  baseline: number;
  blended: number;
  probability: number;
}

const emptyStats = (): Stats => ({
  fgm: 0, fga: 0, ftm: 0, fta: 0, threePm: 0,
  pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, turnovers: 0,
});

const add = (left: Stats, right: Stats) => Object.fromEntries(
  STAT_KEYS.map((key) => [key, left[key] + right[key]]),
) as Stats;

const mean = (rows: GameRow[]) => {
  if (!rows.length) return emptyStats();
  const total = rows.reduce((sum, row) => add(sum, row.stats), emptyStats());
  return Object.fromEntries(STAT_KEYS.map((key) => [key, total[key] / rows.length])) as Stats;
};

const blend = (season: Stats, month: Stats, week: Stats) => Object.fromEntries(
  STAT_KEYS.map((key) => [key, season[key] * 0.55 + month[key] * 0.3 + week[key] * 0.15]),
) as Stats;

const normalize = (row: ProviderRow): GameRow | undefined => {
  const playerId = Number(row.PlayerID);
  const date = String(row.Day ?? row.DateTime ?? "").slice(0, 10);
  if (!Number.isFinite(playerId) || !date || Number(row.Games ?? 1) <= 0 || Number(row.Minutes ?? 1) <= 0) return undefined;
  const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    playerId,
    name: String(row.Name ?? `Player ${playerId}`),
    date,
    stats: {
      fgm: number(row.FieldGoalsMade),
      fga: number(row.FieldGoalsAttempted),
      ftm: number(row.FreeThrowsMade),
      fta: number(row.FreeThrowsAttempted),
      threePm: number(row.ThreePointersMade),
      pts: number(row.Points),
      reb: number(row.Rebounds),
      ast: number(row.Assists),
      stl: number(row.Steals),
      blk: number(row.BlockedShots),
      turnovers: number(row.Turnovers),
    },
  };
};

const daysBetween = (left: string, right: string) =>
  Math.floor((Date.parse(right) - Date.parse(left)) / 86_400_000);

const mondayFor = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  const mondayOffset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - mondayOffset);
  return value.toISOString().slice(0, 10);
};

const buildForecasts = (rows: GameRow[], priors: Stats): ForecastRow[] => {
  const histories = new Map<number, GameRow[]>();
  return [...rows]
    .sort((left, right) => left.date.localeCompare(right.date))
    .flatMap((row) => {
      const history = histories.get(row.playerId) ?? [];
      const season = mean(history);
      const monthRows = history.filter((item) => daysBetween(item.date, row.date) <= 30);
      const weekRows = history.filter((item) => daysBetween(item.date, row.date) <= 7);
      const month = mean(monthRows.length ? monthRows : history);
      const week = mean(weekRows.length ? weekRows : monthRows.length ? monthRows : history);
      const blended = blend(season, month, week);
      const reliability = history.length / (history.length + 8);
      const probability = Object.fromEntries(
        STAT_KEYS.map((key) => [key, blended[key] * reliability + priors[key] * (1 - reliability)]),
      ) as Stats;
      histories.set(row.playerId, [...history, row]);
      return history.length ? [{ ...row, baseline: month, blended, probability, sampleSize: history.length }] : [];
    });
};

const categoryScore = (stats: Stats) => ({
  fgPct: stats.fga > 0 ? stats.fgm / stats.fga : 0,
  ftPct: stats.fta > 0 ? stats.ftm / stats.fta : 0,
  threePm: stats.threePm,
  pts: stats.pts,
  reb: stats.reb,
  ast: stats.ast,
  stl: stats.stl,
  blk: stats.blk,
  turnovers: stats.turnovers,
});

const categoryWins = (team: Stats, opponent: Stats) => {
  const left = categoryScore(team);
  const right = categoryScore(opponent);
  const categories = ["fgPct", "ftPct", "threePm", "pts", "reb", "ast", "stl", "blk"] as const;
  let wins = categories.reduce((sum, key) => sum + (left[key] > right[key] ? 1 : left[key] === right[key] ? 0.5 : 0), 0);
  wins += left.turnovers < right.turnovers ? 1 : left.turnovers === right.turnovers ? 0.5 : 0;
  return wins;
};

const staticRank = (projection: Stats, team: Stats, opponent: Stats) => {
  const current = categoryScore(team);
  const other = categoryScore(opponent);
  let score = 0;
  for (const key of COUNT_CATEGORIES) {
    const losing = key === "turnovers" ? current[key] > other[key] : current[key] < other[key];
    const direction = key === "turnovers" ? -1 : 1;
    score += projection[key] * direction * (losing ? 2 : 0.5);
  }
  score += (projection.fgm - other.fgPct * projection.fga) * (current.fgPct <= other.fgPct ? 4 : 1);
  score += (projection.ftm - other.ftPct * projection.fta) * (current.ftPct <= other.ftPct ? 4 : 1);
  return score;
};

const probabilityRank = (projection: Stats, team: Stats, opponent: Stats) => {
  const before = categoryWins(team, opponent);
  return categoryWins(add(team, projection), opponent) - before;
};

const rosteredPlayers = (rows: GameRow[], teamCount: number) => {
  const totals = new Map<number, GameRow[]>();
  rows.forEach((row) => totals.set(row.playerId, [...(totals.get(row.playerId) ?? []), row]));
  return [...totals.entries()]
    .map(([playerId, playerRows]) => ({ playerId, value: staticRank(mean(playerRows), emptyStats(), emptyStats()) }))
    .sort((left, right) => right.value - left.value)
    .slice(0, teamCount * 13)
    .map(({ playerId }, index) => ({ playerId, team: index % teamCount }));
};

const aggregateRows = (rows: GameRow[], playerIds: Set<number>) => rows
  .filter((row) => playerIds.has(row.playerId))
  .reduce((sum, row) => add(sum, row.stats), emptyStats());

const simulate = (rows: GameRow[], forecasts: ForecastRow[], trainingCutoff: string, heldoutStart: string) => {
  const training = rows.filter((row) => row.date <= trainingCutoff);
  const heldoutDates = [...new Set(rows.filter((row) => row.date >= heldoutStart).map((row) => row.date))].sort();
  const forecastByDate = new Map<string, ForecastRow[]>();
  forecasts.forEach((row) => forecastByDate.set(row.date, [...(forecastByDate.get(row.date) ?? []), row]));
  const results: ScenarioResult[] = [];

  for (const teamCount of [8, 10, 12]) {
    const assignments = rosteredPlayers(training, teamCount);
    const rostered = new Set(assignments.map(({ playerId }) => playerId));
    for (const date of heldoutDates) {
      const dayIndex = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
      if (dayIndex === 0) continue;
      const week = mondayFor(date);
      const weekEnd = new Date(`${week}T12:00:00Z`);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      const end = weekEnd.toISOString().slice(0, 10);
      const candidates = (forecastByDate.get(date) ?? []).filter((row) => !rostered.has(row.playerId));
      if (candidates.length < 5) continue;
      for (let teamIndex = 0; teamIndex + 1 < teamCount; teamIndex += 2) {
        const teamIds = new Set(assignments.filter((item) => item.team === teamIndex).map((item) => item.playerId));
        const opponentIds = new Set(assignments.filter((item) => item.team === teamIndex + 1).map((item) => item.playerId));
        const currentRows = rows.filter((row) => row.date >= week && row.date < date);
        const finalRows = rows.filter((row) => row.date >= week && row.date <= end);
        const currentTeam = aggregateRows(currentRows, teamIds);
        const currentOpponent = aggregateRows(currentRows, opponentIds);
        const finalTeam = aggregateRows(finalRows, teamIds);
        const finalOpponent = aggregateRows(finalRows, opponentIds);
        const noMove = categoryWins(finalTeam, finalOpponent);
        const selected = Object.fromEntries((["baseline", "blended", "probability"] as CandidateName[]).map((model) => {
          const ranked = [...candidates].sort((left, right) => {
            const leftProjection = left[model];
            const rightProjection = right[model];
            const scorer = model === "probability" ? probabilityRank : staticRank;
            return scorer(rightProjection, currentTeam, currentOpponent) - scorer(leftProjection, currentTeam, currentOpponent);
          });
          return [model, ranked[0]];
        })) as Record<CandidateName, ForecastRow>;
        results.push({
          cluster: `${teamCount}:${week}`,
          baseline: categoryWins(add(finalTeam, selected.baseline.stats), finalOpponent) - noMove,
          blended: categoryWins(add(finalTeam, selected.blended.stats), finalOpponent) - noMove,
          probability: categoryWins(add(finalTeam, selected.probability.stats), finalOpponent) - noMove,
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

const seededRandom = (seed: number) => () => {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  return seed / 4_294_967_296;
};

const bootstrapInterval = (results: ScenarioResult[], candidate: Exclude<CandidateName, "baseline">) => {
  const clusters = [...new Set(results.map((result) => result.cluster))];
  const random = seededRandom(20260716);
  const samples = Array.from({ length: 1000 }, () => {
    const selected = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]);
    const rows = selected.flatMap((cluster) => results.filter((result) => result.cluster === cluster));
    return rows.reduce((sum, result) => sum + result[candidate] - result.baseline, 0) / Math.max(1, rows.length);
  }).sort((left, right) => left - right);
  return { lower: samples[25] ?? 0, upper: samples[974] ?? 0 };
};

const fetchRows = async (season: string, apiKey: string) => {
  const cacheDir = path.resolve(".cache/recommender");
  const cachePath = path.join(cacheDir, `${season}.json`);
  await mkdir(cacheDir, { recursive: true });
  if (existsSync(cachePath)) return JSON.parse(await readFile(cachePath, "utf8")) as ProviderRow[];
  const response = await fetch(`${API_BASE}/PlayerGameStatsBySeason/${season}`, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!response.ok) throw new Error(`SportsDataIO returned ${response.status}: ${await response.text()}`);
  const payload = await response.json() as ProviderRow[];
  await writeFile(cachePath, JSON.stringify(payload), "utf8");
  return payload;
};

const main = async () => {
  const season = process.argv.find((argument) => argument.startsWith("--season="))?.split("=")[1] ?? "2025REG";
  const apiKey = process.env.SPORTSDATAIO_API_KEY;
  if (!apiKey) throw new Error("SPORTSDATAIO_API_KEY is required for the historical backtest.");
  const rows = (await fetchRows(season, apiKey)).map(normalize).filter((row): row is GameRow => Boolean(row));
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  if (dates.length < 60) throw new Error(`Only ${dates.length} game dates were returned; a complete regular season is required.`);
  const trainingCutoff = dates[Math.floor(dates.length * 0.6)];
  const heldoutStart = dates[Math.floor(dates.length * 0.8)];
  const priors = mean(rows.filter((row) => row.date <= trainingCutoff));
  const forecasts = buildForecasts(rows, priors);
  const heldout = forecasts.filter((row) => row.date >= heldoutStart);
  const scenarios = simulate(rows, forecasts, trainingCutoff, heldoutStart);
  const projectionError = Object.fromEntries(
    (["baseline", "blended", "probability"] as CandidateName[]).map((model) => [model, normalizedMae(heldout, model)]),
  ) as Record<CandidateName, number>;
  const utility = Object.fromEntries(
    (["baseline", "blended", "probability"] as CandidateName[]).map((model) => [
      model,
      scenarios.reduce((sum, result) => sum + result[model], 0) / Math.max(1, scenarios.length),
    ]),
  ) as Record<CandidateName, number>;
  const intervals = {
    blended: bootstrapInterval(scenarios, "blended"),
    probability: bootstrapInterval(scenarios, "probability"),
  };
  const eligible = (["blended", "probability"] as const).filter((model) =>
    intervals[model].lower > 0 && projectionError[model] <= projectionError.baseline * 1.02,
  );
  const selected = eligible.sort((left, right) => utility[right] - utility[left])[0] ?? "baseline";
  const report = {
    generatedAt: new Date().toISOString(),
    season,
    provider: "SportsDataIO Discovery Lab",
    split: { trainingCutoff, heldoutStart },
    rows: rows.length,
    heldoutForecasts: heldout.length,
    scenarios: scenarios.length,
    projectionError,
    realizedCategoryGain: utility,
    confidenceIntervalsVersusBaseline: intervals,
    evidenceGate: "95% clustered-bootstrap lower bound above zero and projection NMAE within 2% of baseline",
    selected,
  };
  await mkdir(path.resolve("reports"), { recursive: true });
  await writeFile(path.resolve("reports/recommender-backtest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (selected !== "probability") process.exitCode = 2;
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
