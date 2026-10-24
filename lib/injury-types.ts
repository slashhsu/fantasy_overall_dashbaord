import type { UpdateStatus } from "@/lib/types";
export interface InjuryPlayer {
  playerKey: string; name: string; team: string; position: string; headshotUrl?: string;
  status: string; statusKnown: boolean; weekGames: number | null; weekMinutes: number | null;
  monthMinutes: number | null; seasonMinutes: number | null; playedDates: string[];
}
export interface InjuryOpportunity {
  id: string; injuredKey: string; beneficiaryKey: string; benefiting: boolean;
  score: number | null; helps: string[]; minutesDelta: number | null;
}
export interface InjuryResponse {
  leagueKey: string; teamKey: string; generatedAt: string; observationDate: string;
  status: "complete" | "partial" | "historical"; players: InjuryPlayer[];
  rosterKeys: string[]; opportunities: InjuryOpportunity[]; warnings: string[];
  updateStatus?: UpdateStatus; demoMode: boolean;
}
export interface InjuryObservation {
  id: string; injuredKey: string; beneficiaryKey: string; nbaTeam: string;
  episodeAt: string; lastInjuredAt: string; lastSeenAt: string;
  beneficiaryMinutes: number | null; closedAt?: string; dismissed?: boolean;
}
export interface HealthyBaseline { playerKey: string; team: string; minutes: number; observedAt: string }
export interface InjuryHistory { version: 1; observations: InjuryObservation[]; healthyBaselines: HealthyBaseline[] }
export interface ReturnAlert {
  id: string; injured: InjuryPlayer; beneficiary: InjuryPlayer; confirmed: boolean;
  roleDeclined: boolean; playedAfterInjury: string[]; previousMinutes: number | null; currentMinutes: number | null;
}
