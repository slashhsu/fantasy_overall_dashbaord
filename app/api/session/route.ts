import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: isRequestAuthenticated(request) });
}
