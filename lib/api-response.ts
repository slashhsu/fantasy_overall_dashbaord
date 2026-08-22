import { NextResponse } from "next/server";
import type { ApiErrorPayload } from "@/lib/types";
import { YahooApiError } from "@/lib/yahoo-client";
import { ConfigurationError, UpstreamError, ValidationError } from "@/lib/errors";

export const unauthorized = () =>
  NextResponse.json<ApiErrorPayload>({ error: "Authentication required.", code: "UNAUTHORIZED" }, {
    status: 401,
    headers: { "Cache-Control": "private, no-store" },
  });

export const handleApiError = (error: unknown) => {
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({
    requestId,
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unexpected server error.",
    ...(error instanceof YahooApiError ? { upstreamStatus: error.status } : {}),
  }));
  if (error instanceof YahooApiError) {
    return NextResponse.json<ApiErrorPayload>(
      {
        error: "Yahoo Fantasy could not complete the request.",
        code: "YAHOO_API_ERROR",
        requestId,
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
