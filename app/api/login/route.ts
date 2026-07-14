import { NextResponse } from "next/server";
import { createSessionToken, safeEqual, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getAuthConfig } from "@/lib/config";
import { handleApiError } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    if (!safeEqual(password, getAuthConfig().appPassword)) {
      return NextResponse.json(
        { error: "That password is not correct." },
        { status: 401 },
      );
    }
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
