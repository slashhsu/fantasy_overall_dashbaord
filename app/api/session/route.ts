import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";
import { RECOMMENDER_MODEL } from "@/lib/recommender-model";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return NextResponse.json({
    authenticated: isRequestAuthenticated(request),
    modelVersion: `${RECOMMENDER_MODEL.id}@${RECOMMENDER_MODEL.version}`,
  });
}
