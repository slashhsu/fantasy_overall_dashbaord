import { NextResponse } from "next/server";
import { handleApiError, unauthorized } from "@/lib/api-response";
import { isRequestAuthenticated } from "@/lib/auth";
import { getDashboard } from "@/lib/dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export async function GET(request: Request) {
  if (!isRequestAuthenticated(request)) return unauthorized();
  try {
    const url = new URL(request.url);
    const leagueKey = url.searchParams.get("leagueKey")?.trim() ?? "";
    const week = Number(url.searchParams.get("week"));
    const targetDate = url.searchParams.get("date")?.trim() ?? "";
    const matchupId = url.searchParams.get("matchupId")?.trim() || undefined;
    if (!leagueKey) throw new Error("leagueKey is required.");
    if (!Number.isInteger(week) || week < 1 || week > 30) throw new Error("week must be a valid number.");
    if (!isIsoDate(targetDate)) throw new Error("date must use YYYY-MM-DD format.");

    const dashboard = await getDashboard({
      leagueKey,
      week,
      targetDate,
      matchupId,
      forceRefresh: url.searchParams.get("forceRefresh") === "true",
    });
    return NextResponse.json(dashboard, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
