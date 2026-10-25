import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";
import { RECOMMENDER_MODEL } from "@/lib/recommender-model";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = getRequestSession(request);
  return NextResponse.json({
    authenticated: session !== null,
    ...(session ? { role: session.role } : {}),
    modelVersion: `${RECOMMENDER_MODEL.id}@${RECOMMENDER_MODEL.version}`,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
