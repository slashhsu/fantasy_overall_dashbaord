import { withUpdateStatus } from "@/lib/update-status";
import { NextResponse } from "next/server";
import { handleApiError, unauthorized } from "@/lib/api-response";
import { isRequestAuthenticated } from "@/lib/auth";
import { getLeagueSummaries } from "@/lib/dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isRequestAuthenticated(request)) return unauthorized();
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";
    const result = await withUpdateStatus(() => getLeagueSummaries(forceRefresh));
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
