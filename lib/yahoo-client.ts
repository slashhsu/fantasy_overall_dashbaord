import "server-only";

import { getYahooConfig } from "@/lib/config";

const API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

const globalTokens = globalThis as typeof globalThis & {
  __yahooFantasyToken?: TokenCache;
};

export class YahooApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public responseBody?: string,
  ) {
    super(message);
    this.name = "YahooApiError";
  }
}

const refreshAccessToken = async (force = false) => {
  const existing = globalTokens.__yahooFantasyToken;
  if (!force && existing && existing.expiresAt > Date.now() + 60_000) {
    return existing.accessToken;
  }

  const config = getYahooConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.refreshToken,
    redirect_uri: config.redirectUri,
  });
  const basicCredentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicCredentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new YahooApiError("Yahoo OAuth token refresh failed.", response.status, responseBody);
  }

  const token = JSON.parse(responseBody) as { access_token?: string; expires_in?: number };
  if (!token.access_token) {
    throw new YahooApiError("Yahoo OAuth response did not include an access token.", 502, responseBody);
  }
  globalTokens.__yahooFantasyToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  };
  return token.access_token;
};

const requestYahoo = async (path: string, retryAuth = true): Promise<string> => {
  const accessToken = await refreshAccessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/xml",
    },
    cache: "no-store",
  });

  if (response.status === 401 && retryAuth) {
    await refreshAccessToken(true);
    return requestYahoo(path, false);
  }

  const responseBody = await response.text();
  if (!response.ok) {
    throw new YahooApiError(`Yahoo Fantasy request failed for ${path}.`, response.status, responseBody);
  }
  return responseBody;
};

export const fetchYahooXml = (path: string) => requestYahoo(path);

export const resetYahooTokenForTests = () => {
  delete globalTokens.__yahooFantasyToken;
};
