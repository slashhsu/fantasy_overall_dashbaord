import { canAccessLeague } from "@/lib/league-access";
import { withUpdateStatus } from "@/lib/update-status";
import { NextResponse } from "next/server";
import { handleApiError, unauthorized, forbidden } from "@/lib/api-response";
import { getRequestSession } from "@/lib/auth";
import { getDashboard } from "@/lib/dashboard-service";
import { requireIsoDate, requireTimeZone } from "@/lib/date-time";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return unauthorized();
  try {
    const url = new URL(request.url);
    const leagueKey = url.searchParams.get("leagueKey")?.trim() ?? "";
    const week = Number(url.searchParams.get("week"));
    const targetDate = url.searchParams.get("date")?.trim() ?? "";
    const timeZone = url.searchParams.get("timeZone")?.trim() ?? "America/New_York";
    const recommendationHorizon = url.searchParams.get("recommendationHorizon") ?? "daily";
    if (recommendationHorizon !== "daily" && recommendationHorizon !== "remaining-week") throw new ValidationError("Invalid recommendationHorizon.");
    const matchupId = url.searchParams.get("matchupId")?.trim() || undefined;
    if (!leagueKey) throw new ValidationError("leagueKey is required.");
    if (!Number.isInteger(week) || week < 1 || week > 30) throw new ValidationError("week must be a valid number.");
    requireIsoDate(targetDate);
    requireTimeZone(timeZone);

    if (!canAccessLeague(session, leagueKey)) return forbidden();
    const dashboard = await withUpdateStatus(() => getDashboard({
      recommendationHorizon,
      leagueKey,
      week,
      targetDate,
      timeZone,
      matchupId,
      teamKey: url.searchParams.get("teamKey")?.trim() || undefined,
      forceRefresh: url.searchParams.get("forceRefresh") === "true",
    }));
    return NextResponse.json(dashboard, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
