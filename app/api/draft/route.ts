import { withUpdateStatus } from "@/lib/update-status";
import { NextResponse } from "next/server";
import { handleApiError, unauthorized } from "@/lib/api-response";
import { isRequestAuthenticated } from "@/lib/auth";
import { getDraftData } from "@/lib/draft-service";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isRequestAuthenticated(request)) return unauthorized();
  try {
    const url = new URL(request.url);
    const leagueKey = url.searchParams.get("leagueKey")?.trim() ?? "";
    if (!leagueKey) throw new ValidationError("leagueKey is required.");
    const data = await withUpdateStatus(() => getDraftData(leagueKey, url.searchParams.get("forceRefresh") === "true"));
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
