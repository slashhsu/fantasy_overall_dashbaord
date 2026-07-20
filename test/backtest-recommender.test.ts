import { describe, expect, it } from "vitest";
import {
  buildFeatures,
  emptyStats,
  normalize,
  passesEvidenceGate,
  tuneEnsembleWeights,
  zScoreRank,
  type ForecastRow,
  type GameRow,
} from "@/scripts/backtest-recommender";

const statsWith = (values: Partial<ReturnType<typeof emptyStats>>) => ({ ...emptyStats(), ...values });

const forecast = (playerId: number, values: Partial<ReturnType<typeof emptyStats>>): ForecastRow => {
  const stats = statsWith(values);
  return {
    playerId,
    name: `Player ${playerId}`,
    position: "G",
    team: "A",
    opponent: "B",
    date: "2026-02-01",
    minutes: 25,
    played: true,
    stats,
    baseline: stats,
    blended: stats,
    probability: stats,
    vendor: stats,
    ensemble: stats,
    sampleSize: 20,
  };
};

describe("historical recommender evaluation", () => {
  it("keeps an unexpected DNP as a zero-valued target without using same-day data in history", () => {
    const actual = [
      normalize({ PlayerID: 1, Name: "Player", Position: "G", Day: "2026-01-01", Games: 1, Minutes: 20, Points: 10 }),
      normalize({ PlayerID: 1, Name: "Player", Position: "G", Day: "2026-01-15", Games: 1, Minutes: 24, Points: 20 }),
      normalize({ PlayerID: 1, Name: "Player", Position: "G", Day: "2026-02-01", Games: 0, Minutes: 0, Points: 0 }),
    ].filter((row): row is GameRow => Boolean(row));
    const vendor = normalize({
      PlayerID: 1,
      Name: "Player",
      Position: "G",
      Day: "2026-02-01",
      Games: 1,
      Minutes: 25,
      Points: 18,
    });

    const features = buildFeatures(actual, vendor ? [vendor] : []);

    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ played: false, sampleSize: 2 });
    expect(features[0].stats.pts).toBe(0);
    expect(features[0].season.pts).toBe(15);
    expect(features[0].vendor.pts).toBe(18);
  });

  it("learns ensemble weights from the supplied validation rows", () => {
    const row = forecast(1, { pts: 10 });
    row.probability = statsWith({ pts: 2 });
    row.vendor = statsWith({ pts: 10 });

    expect(tuneEnsembleWeights([row]).pts).toBe(1);
  });

  it("uses production-style category priorities and Z-scores for the baseline", () => {
    const assistSpecialist = forecast(1, { ast: 10 });
    const scorer = forecast(2, { pts: 20 });
    const team = statsWith({ pts: 1_000, ast: 90, turnovers: 100 });
    const opponent = statsWith({ pts: 900, ast: 100, turnovers: 100 });

    expect(zScoreRank([assistSpecialist, scorer], "baseline", team, opponent)?.playerId).toBe(1);
  });

  it("requires both a positive confidence lower bound and the two-percent error guard", () => {
    expect(passesEvidenceGate(0.646, 0.651, { lower: 0.017, upper: 0.082 })).toBe(true);
    expect(passesEvidenceGate(0.646, 0.651, { lower: -0.001, upper: 0.082 })).toBe(false);
    expect(passesEvidenceGate(0.67, 0.651, { lower: 0.017, upper: 0.082 })).toBe(false);
  });
});
