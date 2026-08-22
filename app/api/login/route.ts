import { NextResponse } from "next/server";
import { createSessionToken, safeEqual, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getAuthConfig } from "@/lib/config";
import { handleApiError } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { clearLoginFailures, loginRateLimit, recordLoginFailure } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const limit = loginRateLimit(request);
    if (limit.blocked) {
      return NextResponse.json({ error: "Too many login attempts. Try again later." }, {
        status: 429,
        headers: { "Cache-Control": "private, no-store", "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
    let body: { password?: unknown };
    try { body = (await request.json()) as { password?: unknown }; }
    catch { throw new ValidationError("Request body must be valid JSON."); }
    const password = typeof body.password === "string" ? body.password : "";
    if (!safeEqual(password, getAuthConfig().appPassword)) {
      const failed = await recordLoginFailure(request);
      return NextResponse.json(
        { error: "That password is not correct." },
        {
          status: 401,
          headers: {
            "Cache-Control": "private, no-store",
            ...(failed.blocked ? { "Retry-After": String(failed.retryAfterSeconds) } : {}),
          },
        },
      );
    }
    clearLoginFailures(request);
    const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "private, no-store" } });
    response.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
