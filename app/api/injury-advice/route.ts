import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import { handleApiError, unauthorized } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { requireIsoDate, requireTimeZone } from "@/lib/date-time";
import { getInjuryAdvice } from "@/lib/injury-service";
import { withUpdateStatus } from "@/lib/update-status";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!isRequestAuthenticated(request)) return unauthorized();
  try {
    const params = new URL(request.url).searchParams;
    const leagueKey = params.get("leagueKey")?.trim() ?? "", teamKey = params.get("teamKey")?.trim() ?? "";
    const week = Number(params.get("week")), date = requireIsoDate(params.get("date") ?? ""), timeZone = requireTimeZone(params.get("timeZone") ?? "America/Los_Angeles");
    if (!leagueKey || !teamKey || !Number.isInteger(week) || week < 1 || week > 30) throw new ValidationError("leagueKey, teamKey and a valid week are required.");
    const watchKeys = [...new Set((params.get("watch") ?? "").split(",").filter(Boolean))];
    if (watchKeys.length > 50 || watchKeys.some((key) => !/^[a-zA-Z0-9-]+\.p\.\d+$/.test(key))) throw new ValidationError("Invalid observed player keys.");
    const data = await withUpdateStatus(() => getInjuryAdvice({ leagueKey, teamKey, week, date, timeZone, watchKeys, forceRefresh: params.get("forceRefresh") === "true" }));
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return handleApiError(error); }
}
