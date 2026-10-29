import { NextResponse } from "next/server";
import type { ApiErrorPayload } from "@/lib/types";
import { YahooApiError } from "@/lib/yahoo-client";
import { ConfigurationError, UpstreamError, ValidationError, ProviderBusyError } from "@/lib/errors";

export const unauthorized = () =>
  NextResponse.json<ApiErrorPayload>({ error: "Authentication required.", code: "UNAUTHORIZED" }, {
    status: 401,
    headers: { "Cache-Control": "private, no-store" },
  });

export const forbidden = () => NextResponse.json<ApiErrorPayload>(
  { error: "You do not have access to this league.", code: "FORBIDDEN" },
  { status: 403, headers: { "Cache-Control": "private, no-store" } },
);

export const handleApiError = (error: unknown) => {
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({
    requestId,
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unexpected server error.",
    ...(error instanceof YahooApiError ? { upstreamStatus: error.status } : {}),
  }));
  if (error instanceof ProviderBusyError || (error instanceof YahooApiError && error.status === 429)) {
    const retryAfter = error.retryAfterSeconds ?? 60;
    return NextResponse.json({ error: `Yahoo is busy or temporarily rate limited. Please retry in ${retryAfter} seconds.`, code: "PROVIDER_BUSY", retryAfterSeconds: retryAfter, requestId },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": String(retryAfter) } });
  }
  if (error instanceof YahooApiError) {
    const oauthFailure = error.source === "oauth";
    return NextResponse.json<ApiErrorPayload>(
      {
        error: oauthFailure
          ? `Yahoo OAuth token refresh failed (${error.status}).`
          : `Yahoo Fantasy API request failed (${error.status}).`,
        code: oauthFailure ? "YAHOO_OAUTH_ERROR" : "YAHOO_API_ERROR",
        requestId,
        upstreamStatus: error.status,
      },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const configurationError = error instanceof ConfigurationError;
  const validationError = error instanceof ValidationError;
  const upstreamError = error instanceof UpstreamError;
  const status = configurationError ? 503 : validationError ? 400 : upstreamError ? 502 : 500;
  return NextResponse.json<ApiErrorPayload>(
    {
      error: configurationError
        ? "The dashboard is not fully configured."
        : validationError ? error.message : upstreamError ? "A data provider could not complete the request." : "Unexpected server error.",
      code: configurationError ? "CONFIGURATION_ERROR" : validationError ? "VALIDATION_ERROR" : upstreamError ? "UPSTREAM_ERROR" : "INTERNAL_ERROR",
      requestId,
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
};
