import { NextResponse } from "next/server";
import type { ApiErrorPayload } from "@/lib/types";
import { YahooApiError } from "@/lib/yahoo-client";

export const unauthorized = () =>
  NextResponse.json<ApiErrorPayload>({ error: "Authentication required.", code: "UNAUTHORIZED" }, { status: 401 });

export const handleApiError = (error: unknown) => {
  console.error(error);
  if (error instanceof YahooApiError) {
    const status = error.status === 401 || error.status === 403 ? 502 : error.status >= 500 ? 502 : 400;
    return NextResponse.json<ApiErrorPayload>(
      {
        error: "Yahoo Fantasy could not complete the request.",
        code: "YAHOO_API_ERROR",
        details: error.status === 401 || error.status === 403
          ? "Check the Yahoo client credentials and refresh token in Vercel."
          : `Yahoo returned status ${error.status}.`,
      },
      { status },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const configurationError = message.startsWith("Missing required environment variable:");
  return NextResponse.json<ApiErrorPayload>(
    {
      error: configurationError ? "The dashboard is not fully configured." : message,
      code: configurationError ? "CONFIGURATION_ERROR" : "DASHBOARD_ERROR",
      details: configurationError ? message : undefined,
    },
    { status: configurationError ? 503 : 400 },
  );
};
