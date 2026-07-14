export type MatchupSide = "Win" | "Lose" | "Draw" | "No Data";

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
  userTeam: LeagueTeamSummary;
}

export interface LeagueCategory {
  statId: string;
  name: string;
  displayName: string;
  position: number;
  enabled: boolean;
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
  period: "lastmonth" | "lastweek" | "season" | "unavailable";
  stats: Record<string, number>;
}

export interface Recommendation {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  headshotUrl?: string;
  gameToday: boolean;
  period: FreeAgent["period"];
  gamesPlayed: number;
  score: number;
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
  teamsPlaying: string[];
  freeAgentCount: number;
  recommendations: Recommendation[];
}

export interface ApiErrorPayload {
  error: string;
  code?: string;
  details?: string;
}
