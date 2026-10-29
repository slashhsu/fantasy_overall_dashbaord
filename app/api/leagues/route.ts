import { visibleLeagues } from "@/lib/league-access";
import { withUpdateStatus } from "@/lib/update-status";
import { NextResponse } from "next/server";
import { handleApiError, unauthorized } from "@/lib/api-response";
import { getRequestSession } from "@/lib/auth";
import { getLeagueSummaries } from "@/lib/dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return unauthorized();
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";
    const result = await withUpdateStatus(() => getLeagueSummaries(forceRefresh));
    return NextResponse.json({ ...result, leagues: visibleLeagues(session, result.leagues) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
