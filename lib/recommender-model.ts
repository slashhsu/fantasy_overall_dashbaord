import type { RecommendationModelSummary } from "@/lib/types";
import artifact from "@/model-artifacts/recommender.json";

export type RecommenderCandidate = "baseline" | "blended" | "probability";

const candidate = artifact.selectedModel as RecommenderCandidate;
export const SELECTED_RECOMMENDER: RecommenderCandidate = artifact.status === "completed"
  ? candidate
  : "baseline";

const MODEL_PRESENTATION: Record<RecommenderCandidate, Pick<RecommendationModelSummary, "id" | "name" | "scoreLabel">> = {
  baseline: { id: "legacy-z-score", name: "Legacy category fit", scoreLabel: "Weighted category fit" },
  blended: { id: "blended-z-score", name: "Blended category fit", scoreLabel: "Weighted category fit" },
  probability: { id: "matchup-swing", name: "Matchup Swing", scoreLabel: "Expected categories added" },
};

export const RECOMMENDER_MODEL: RecommendationModelSummary = {
  ...MODEL_PRESENTATION[SELECTED_RECOMMENDER],
  version: artifact.modelVersion,
  selectedModel: SELECTED_RECOMMENDER,
  selectionStatus: SELECTED_RECOMMENDER === "baseline" ? "baseline-retained" : "historical-validated",
  backtestMessage: artifact.message,
  validationLabel: artifact.validationLabel,
};

export const MODEL_PARAMETERS = {
  ...artifact.parameters,
  windowWeightsByStat: artifact.parameters.windowWeightsByStat as Record<string, Partial<Record<"season" | "lastmonth" | "lastweek", number>>>,
  attemptVolumeFallbackPerGame: artifact.parameters.attemptVolumeFallbackPerGame as Record<string, number>,
  averageWeeklyAttempts: artifact.parameters.averageWeeklyAttempts as Record<string, number>,
  weeklyResidualStandardDeviation: artifact.parameters.weeklyResidualStandardDeviation as Record<string, number>,
} as const;
