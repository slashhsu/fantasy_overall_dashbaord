export interface UpdateStatus {
  fetchedAt: string;
  stale: boolean;
  nextRefreshAt: string;
}

export type MatchupSide = "Win" | "Lose" | "Draw" | "No Data";
export type PlayerStatPeriod = "lastmonth" | "lastweek" | "season";
export type LeagueScoringFormat = "each-category" | "most-categories" | "rotisserie" | "points" | "unknown";
export type DraftMode = "snake" | "linear" | "salary-cap" | "offline" | "unknown";
export type ProjectionSource = "current-season" | "previous-season" | "market-only";
export type ValidationCoverage = "validated" | "modeled-unvalidated" | "unsupported";

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
  teamCount?: number;
  draftStatus?: string;
  draftType?: string;
  userTeam: LeagueTeamSummary;
}

export interface LeagueCategory {
  statId: string;
  name: string;
  displayName: string;
  position: number;
  enabled: boolean;
  scoringModifier?: number;
}

export interface RosterPosition {
  position: string;
  count: number;
}

export interface LeagueConfiguration {
  categories: LeagueCategory[];
  rosterPositions: RosterPosition[];
  scoringFormat: LeagueScoringFormat;
  teamCount?: number;
  draftStatus?: string;
  draftType?: string;
  draftMode?: DraftMode;
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
  startDate?: string;
  endDate?: string;
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
  playerId?: string;
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
  projectionSource?: ProjectionSource;
  projectionSeason?: number | null;
  dataWarnings?: string[];
}

export interface DraftAnalysis {
  averagePick: number | null;
  averageRound: number | null;
  averageCost: number | null;
  percentDrafted: number | null;
}

export type DraftProjectionSource = ProjectionSource;

export interface DraftPlayer {
  playerKey: string;
  playerId: string;
  name: string;
  position: string;
  eligiblePositions: string[];
  team: string;
  headshotUrl?: string;
  status?: string;
  yahooRank: number | null;
  draftAnalysis: DraftAnalysis;
  gamesPlayed: number;
  projectionSeason: number | null;
  projectionSource: DraftProjectionSource;
  stats: Record<string, number>;
}

export interface DraftResult {
  pick: number;
  round: number;
  teamKey: string;
  playerKey: string;
  cost?: number;
}

export interface DraftDataResponse {
  updateStatus?: UpdateStatus;
  generatedAt: string;
  cached: boolean;
  demoMode: boolean;
  league: LeagueSummary;
  configuration: LeagueConfiguration;
  players: DraftPlayer[];
  draftResults: DraftResult[];
  draftTeams: LeagueTeamSummary[];
  draftMode: DraftMode;
  sync: DraftSyncState;
  auction: { defaultBudget: number };
  projectionSeason: number | null;
  projectionSource: DraftProjectionSource;
  model: {
    id: "dynamic-draft-value";
    name: "Dynamic Draft Value";
    version: "2.0.0";
    method: "roster-aware-h-score";
  };
}

export type DraftCategoryMode = "target" | "balanced" | "punt";

export interface DraftSyncState {
  status: "live" | "stale" | "error" | "mock";
  lastSuccessfulAt: string | null;
  message?: string;
}

export interface DraftCategoryScore {
  statId: string;
  displayName: string;
  zScore: number;
  weightedScore: number;
}

export interface DraftRanking {
  player: DraftPlayer;
  rank: number;
  score: number;
  baseValue: number;
  teamFit: number;
  scarcity: number;
  turnUrgency: number;
  availabilityNextTurn: number | null;
  estimatedReturn: number | null;
  recommendedPrice: number | null;
  maxBid: number | null;
  auctionValue: number | null;
  recommendedSlot: string;
  confidence: "High" | "Medium" | "Low" | "Market";
  confidenceScore: number;
  confidenceReasons: string[];
  categoryScores: DraftCategoryScore[];
  reasons: string[];
  watchouts: string[];
}

export interface DraftTeamProfile {
  statId: string;
  displayName: string;
  zScore: number;
  percentile: number;
  mode: DraftCategoryMode;
}

export interface DraftBoardResult {
  rankings: DraftRanking[];
  teamProfile: DraftTeamProfile[];
  currentPick: number;
  nextUserPick: number;
  followingUserPick: number;
  round: number;
  picksUntilTurn: number;
  inferredPunts: string[];
}

export interface RosterPlayer extends FreeAgent {
  selectedPosition?: string;
}

export interface RosterSnapshot {
  stale?: boolean;
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
  coverage?: ValidationCoverage;
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
  remainingGames?: number | null;
  usableGames?: number | null;
  remainingGamesComplete?: boolean;
  gameToday: boolean;
  gameVerified: boolean;
  period: FreeAgent["period"];
  projectionBasis: "blended" | "single-window";
  gamesPlayed: number;
  score: number;
  scoreType: "expected-categories" | "matchup-probability" | "fantasy-points" | "roto-points" | "legacy-z-score" | "blended-z-score";
  rawScore: number;
  riskAdjustedScore: number;
  confidence: "High" | "Medium" | "Low" | "Market";
  confidenceScore: number;
  confidenceReasons: string[];
  projectionSource: ProjectionSource;
  validationCoverage: ValidationCoverage;
  lockVerified: boolean;
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
  selectedModel: "baseline" | "blended" | "probability";
  selectionStatus: "historical-validated" | "baseline-retained";
  backtestMessage: string;
  validationLabel?: string;
}

export type ScheduleSource = "balldontlie" | "espn" | "demo";

export interface ScheduleGame {
  id: string;
  date: string;
  startTime: string | null;
  status: "scheduled" | "in-progress" | "final" | "postponed" | "unknown";
  homeTeam: string;
  awayTeam: string;
}

export interface ScheduleInfo {
  status: "available" | "unverified" | "unavailable";
  source: ScheduleSource | null;
  fallbackUsed: boolean;
  message?: string;
  games: ScheduleGame[];
}

export interface NbaScheduleResult {
  teamsPlaying: string[];
  schedule: ScheduleInfo;
}

export interface DataQualitySummary {
  status: "complete" | "partial" | "unavailable";
  projectionSource: ProjectionSource | "mixed";
  failedWindows: PlayerStatPeriod[];
  warnings: string[];
  stale: boolean;
}

export interface CategoryCoverage {
  statId: string;
  displayName: string;
  coverage: ValidationCoverage;
  message?: string;
}

export interface LeagueTeamStats {
  teamKey: string;
  name: string;
  rank?: number;
  stats: Record<string, string>;
}

export interface StandingsContext {
  available: boolean;
  teams: LeagueTeamStats[];
  message?: string;
}

export interface RecommendationPeriod {
  startDate: string | null;
  endDate: string | null;
  timeZone: string;
  status: "complete" | "partial" | "unavailable";
  message?: string;
}

export interface DashboardResponse {
  recommendationHorizon?: "daily" | "remaining-week";
  recommendationPeriod?: RecommendationPeriod;
  updateStatus?: UpdateStatus;
  generatedAt: string;
  cached: boolean;
  demoMode: boolean;
  league: LeagueSummary;
  week: number;
  targetDate: string;
  timeZone: string;
  objective: "expected-categories" | "matchup-probability" | "fantasy-points" | "roto-points";
  selectedMatchupId: string;
  selectedTeamKey: string;
  selectedTeamName: string;
  opponentName: string;
  categories: LeagueCategory[];
  matchups: Matchup[];
  categoryNeeds: MatchupCategoryRow[];
  schedule: ScheduleInfo;
  model: RecommendationModelSummary;
  dataQuality: DataQualitySummary;
  categoryCoverage: CategoryCoverage[];
  standingsContext: StandingsContext;
  lineupAvailable: boolean;
  lineupMessage?: string;
  teamsPlaying: string[];
  freeAgentCount: number;
  recommendations: Recommendation[];
}

export interface ApiErrorPayload {
  retryAfterSeconds?: number;
  error: string;
  code?: string;
  details?: string;
  requestId?: string;
  upstreamStatus?: number;
}

export interface WeeklyPlayer {
  playerKey: string;
  name: string;
  team: string;
  position: string;
  headshotUrl?: string;
  stats: Record<string, number | null>;
  missingDates: string[];
  incompleteStats?: string[];
}
export interface MatchupPlayersResponse {
  leagueKey: string;
  matchupId: string;
  week: number;
  startDate: string;
  endDate: string;
  throughDate: string | null;
  status: "complete" | "partial" | "not-started";
  categories: LeagueCategory[];
  teams: { teamKey: string; name: string; players: WeeklyPlayer[]; missingRosterDates: string[] }[];
  updateStatus?: UpdateStatus;
  demoMode: boolean;
}
