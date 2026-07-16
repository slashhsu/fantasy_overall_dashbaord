import type { RecommendationModelSummary } from "@/lib/types";

export const RECOMMENDER_MODEL: RecommendationModelSummary = {
  id: "matchup-swing",
  name: "Matchup Swing",
  version: "1.0.0",
  scoreLabel: "Expected categories added",
  selectionStatus: "provisional",
  backtestMessage: "Probability model is fixture-validated; historical promotion requires the local SportsDataIO backtest.",
};

export const MODEL_PARAMETERS = {
  windowWeights: {
    season: 0.55,
    lastmonth: 0.3,
    lastweek: 0.15,
  },
  priorGames: 8,
  percentagePriorAttempts: 30,
  averageWeeklyAttempts: {
    "Field Goal Percentage": 500,
    "Free Throw Percentage": 125,
    "3-point Percentage": 220,
  },
  weeklyResidualStandardDeviation: {
    "Field Goal Percentage": 0.025,
    "Free Throw Percentage": 0.035,
    "3-point Percentage": 0.045,
    "Field Goals Made": 16,
    "Field Goals Attempted": 28,
    "Free Throws Made": 10,
    "Free Throws Attempted": 12,
    "3-point Shots Made": 8,
    "3-point Shots Attempted": 14,
    "Points Scored": 45,
    "Total Rebounds": 18,
    "Offensive Rebounds": 8,
    "Defensive Rebounds": 14,
    Assists: 14,
    Steals: 5,
    "Blocked Shots": 5,
    Blocks: 5,
    Turnovers: 10,
    "Personal Fouls": 9,
  } as Record<string, number>,
} as const;
