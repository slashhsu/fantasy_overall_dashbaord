export type MatchupSide = "Win" | "Lose" | "Draw" | "No Data";
export type PlayerStatPeriod = "lastmonth" | "lastweek" | "season";
export type LeagueScoringFormat = "each-category" | "most-categories" | "unknown";

export interface LeagueTeamSummary {
  key: string;
  name: string;
}

export interface LeagueSummary {
  gameKey: string;
  leagueKey: string;
  name: string;
  season: number;
  currentWeek: number;
  startWeek: number;
  endWeek: number;
  scoringFormat?: LeagueScoringFormat;
  userTeam: LeagueTeamSummary;
}

export interface LeagueCategory {
  statId: string;
  name: string;
  displayName: string;
  position: number;
  enabled: boolean;
}

export interface RosterPosition {
  position: string;
  count: number;
}

export interface LeagueConfiguration {
  categories: LeagueCategory[];
  rosterPositions: RosterPosition[];
  scoringFormat: LeagueScoringFormat;
}

export interface MatchupTeam {
  teamKey: string;
  name: string;
  logoUrl?: string;
  points?: number;
  projectedPoints?: number;
  stats: Record<string, string>;
}

export interface Matchup {
  id: string;
  week: number;
  status: string;
  isPlayoffs: boolean;
  isConsolation: boolean;
  teamA: MatchupTeam;
  teamB: MatchupTeam;
}

export interface MatchupCategoryRow {
  statId: string;
  category: string;
  displayName: string;
  teamValue: number | null;
  opponentValue: number | null;
  teamRawValue: string;
  opponentRawValue: string;
  result: string;
  side: MatchupSide;
  level: number | null;
  priorityWeight: number;
  lowerIsBetter: boolean;
}

export interface FreeAgent {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  teamName?: string;
  headshotUrl?: string;
  status?: string;
  eligiblePositions?: string[];
  selectedPosition?: string;
  period: PlayerStatPeriod | "unavailable";
  stats: Record<string, number>;
  statWindows?: Partial<Record<PlayerStatPeriod, Record<string, number>>>;
}

export interface RosterPlayer extends FreeAgent {
  selectedPosition?: string;
}

export interface RosterSnapshot {
  available: boolean;
  players: RosterPlayer[];
  message?: string;
}

export interface RecommendationCategoryImpact {
  category: string;
  displayName: string;
  baselineProbability: number;
  projectedProbability: number;
  delta: number;
}

export interface RecommendationLineupImpact {
  status: "fills" | "replaces" | "not-started" | "unknown";
  label: string;
  slot?: string;
  displacedPlayer?: string;
}

export interface Recommendation {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  headshotUrl?: string;
  gameToday: boolean;
  gameVerified: boolean;
  period: FreeAgent["period"];
  projectionBasis: "blended" | "single-window";
  gamesPlayed: number;
  score: number;
  scoreType: "expected-categories" | "matchup-probability" | "legacy-z-score";
  confidence: "High" | "Medium" | "Low";
  lineupImpact: RecommendationLineupImpact;
  categoryImpacts: RecommendationCategoryImpact[];
  reason: string[];
  watchouts: string[];
  projections: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    threePm: number;
    turnovers: number;
  };
}

export interface RecommendationModelSummary {
  id: string;
  name: string;
  version: string;
  scoreLabel: string;
  selectionStatus: "historical-validated" | "fixture-validated" | "provisional";
  backtestMessage: string;
}

export type ScheduleSource = "balldontlie" | "espn" | "demo";

export interface ScheduleInfo {
  status: "available" | "unavailable";
  source: ScheduleSource | null;
  fallbackUsed: boolean;
  message?: string;
}

export interface NbaScheduleResult {
  teamsPlaying: string[];
  schedule: ScheduleInfo;
}

export interface DashboardResponse {
  generatedAt: string;
  cached: boolean;
  demoMode: boolean;
  league: LeagueSummary;
  week: number;
  targetDate: string;
  selectedMatchupId: string;
  selectedTeamKey: string;
  selectedTeamName: string;
  opponentName: string;
  categories: LeagueCategory[];
  matchups: Matchup[];
  categoryNeeds: MatchupCategoryRow[];
  schedule: ScheduleInfo;
  model: RecommendationModelSummary;
  lineupAvailable: boolean;
  lineupMessage?: string;
  teamsPlaying: string[];
  freeAgentCount: number;
  recommendations: Recommendation[];
}

export interface ApiErrorPayload {
  error: string;
  code?: string;
  details?: string;
}
