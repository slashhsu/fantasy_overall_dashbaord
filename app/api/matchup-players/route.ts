import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import { handleApiError, unauthorized } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { getMatchupPlayers } from "@/lib/matchup-players-service";
import { withUpdateStatus } from "@/lib/update-status";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!isRequestAuthenticated(request)) return unauthorized();
  try {
    const params = new URL(request.url).searchParams;
    const leagueKey = params.get("leagueKey")?.trim() ?? "";
    const matchupId = params.get("matchupId")?.trim() ?? "";
    const week = Number(params.get("week"));
    if (!leagueKey || !matchupId || !Number.isInteger(week) || week < 1 || week > 30) throw new ValidationError("leagueKey, matchupId and a valid week are required.");
    const data = await withUpdateStatus(() => getMatchupPlayers({ leagueKey, week, matchupId, forceRefresh: params.get("forceRefresh") === "true" }));
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return handleApiError(error); }
}
