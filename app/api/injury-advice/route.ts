import { canAccessLeague } from "@/lib/league-access";
import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";
import { handleApiError, unauthorized, forbidden } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { requireIsoDate, requireTimeZone } from "@/lib/date-time";
import { getInjuryAdvice } from "@/lib/injury-service";
import { withUpdateStatus } from "@/lib/update-status";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function handle(request: Request) {
  const session = getRequestSession(request);
  if (!session) return unauthorized();
  try {
    const params = new URL(request.url).searchParams;
    let cursor: string | undefined;
    if (request.method === "POST") {
      if (Number(request.headers.get("content-length")) > 520_000) throw new ValidationError("Injury continuation payload is too large.");
      const raw = await request.text();
      if (raw.length > 520_000) throw new ValidationError("Injury continuation payload is too large.");
      let body: unknown;
      try { body = JSON.parse(raw); } catch { throw new ValidationError("Invalid injury continuation body."); }
      if (!body || typeof body !== "object" || !("cursor" in body) || typeof body.cursor !== "string" || body.cursor.length > 512_000) throw new ValidationError("Invalid injury continuation cursor.");
      cursor = body.cursor;
    }
    const leagueKey = params.get("leagueKey")?.trim() ?? "", teamKey = params.get("teamKey")?.trim() ?? "";
    const week = Number(params.get("week")), date = requireIsoDate(params.get("date") ?? ""), timeZone = requireTimeZone(params.get("timeZone") ?? "America/Los_Angeles");
    if (!leagueKey || !teamKey || !Number.isInteger(week) || week < 1 || week > 30) throw new ValidationError("leagueKey, teamKey and a valid week are required.");
    const watchKeys = [...new Set((params.get("watch") ?? "").split(",").filter(Boolean))];
    if (watchKeys.length > 50 || watchKeys.some((key) => !/^[a-zA-Z0-9-]+\.p\.\d+$/.test(key))) throw new ValidationError("Invalid observed player keys.");
    if (!canAccessLeague(session, leagueKey)) return forbidden();
    const data = await withUpdateStatus(() => getInjuryAdvice({ leagueKey, teamKey, week, date, timeZone, watchKeys, cursor, forceRefresh: params.get("forceRefresh") === "true" }));
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return handleApiError(error); }
}

export const GET = handle;
export const POST = handle;
