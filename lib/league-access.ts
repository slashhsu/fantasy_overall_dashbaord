import "server-only";
import { getAuthConfig } from "@/lib/config";
import type { Session } from "@/lib/auth";
import type { LeagueSummary } from "@/lib/types";

// Check before calling any league data service, even if its data is already cached.
export function canAccessLeague(session: Session, leagueKey: string) {
  return session.role === "admin" || getAuthConfig().memberAllowedLeagueKeys.includes(leagueKey);
}
export function visibleLeagues(session: Session, leagues: LeagueSummary[]) {
  if (session.role === "admin") return leagues;
  const allowed = new Set(getAuthConfig().memberAllowedLeagueKeys);
  return leagues.filter((league) => allowed.has(league.leagueKey));
}
