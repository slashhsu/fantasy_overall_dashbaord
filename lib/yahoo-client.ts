import "server-only";

import { pauseYahoo, withYahooSlot, resetYahooGateForTests } from "@/lib/yahoo-request-gate";
import { getYahooConfig } from "@/lib/config";

const API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const TOKEN_TIMEOUT_MS = 8_000;
const API_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

const globalTokens = globalThis as typeof globalThis & {
  __yahooFantasyToken?: TokenCache;
  __yahooFantasyRefresh?: Promise<string>;
};

export class YahooApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public responseBody?: string,
    public source: "oauth" | "fantasy" = "fantasy",
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "YahooApiError";
  }
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const retryDelay = (response: Response, attempt: number) => {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(10_000, retryAfter * 1_000);
  return Math.min(4_000, 400 * 2 ** attempt + Math.floor(Math.random() * 200));
};

const refreshAccessToken = async (force = false) => {
  const existing = globalTokens.__yahooFantasyToken;
  if (!force && existing && existing.expiresAt > Date.now() + 60_000) {
    return existing.accessToken;
  }

  if (globalTokens.__yahooFantasyRefresh) return globalTokens.__yahooFantasyRefresh;
  const refresh = (async () => {
    const config = getYahooConfig();
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      redirect_uri: config.redirectUri,
    });
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const responseBody = await response.text();
    if (!response.ok) throw new YahooApiError("Yahoo OAuth token refresh failed.", response.status, responseBody.slice(0, 2_000), "oauth");
    const token = JSON.parse(responseBody) as { access_token?: string; expires_in?: number };
    if (!token.access_token) throw new YahooApiError("Yahoo OAuth response did not include an access token.", 502, undefined, "oauth");
    globalTokens.__yahooFantasyToken = {
      accessToken: token.access_token,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    };
    return token.access_token;
  })();
  globalTokens.__yahooFantasyRefresh = refresh;
  try {
    return await refresh;
  } finally {
    if (globalTokens.__yahooFantasyRefresh === refresh) delete globalTokens.__yahooFantasyRefresh;
  }
};

const requestYahoo = async (path: string, retryAuth = true): Promise<string> => {
  const accessToken = await refreshAccessToken();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { response, responseBody } = await withYahooSlot(async () => {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/xml" },
        cache: "no-store", signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (response.status === 429) {
        const retryAfter = pauseYahoo(response.headers.get("retry-after"));
        await response.body?.cancel();
        throw new YahooApiError("Yahoo Fantasy rate limit reached.", 429, undefined, "fantasy", retryAfter);
      }
      return { response, responseBody: await response.text() };
    });
    if (response.status === 401 && retryAuth) {
      await refreshAccessToken(true);
      return requestYahoo(path, false);
    }
    if (response.ok) return responseBody;
    if ((response.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
      await wait(retryDelay(response, attempt));
      continue;
    }
    throw new YahooApiError(`Yahoo Fantasy request failed for ${path}.`, response.status, responseBody.slice(0, 2_000));
  }
  throw new YahooApiError(`Yahoo Fantasy retries were exhausted for ${path}.`, 502);
};

export const fetchYahooXml = (path: string) => requestYahoo(path);

export const resetYahooTokenForTests = () => {
  resetYahooGateForTests();
  delete globalTokens.__yahooFantasyToken;
  delete globalTokens.__yahooFantasyRefresh;
};
