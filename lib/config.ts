import { ConfigurationError } from "@/lib/errors";

const numberFromEnv = (name: string, fallback: number, minimum: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
};

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const isDemoMode = () => process.env.YAHOO_DEMO_MODE === "true";

export const getRuntimeConfig = () => ({
  cacheTtlSeconds: numberFromEnv("CACHE_TTL_SECONDS", 300, 0),
  freeAgentLimit: numberFromEnv("FREE_AGENT_LIMIT", 300, 25),
});

export const getAuthConfig = () => {
  const appPassword = required("APP_PASSWORD");
  const configuredSecret = process.env.SESSION_SECRET?.trim();
  const production = process.env.NODE_ENV === "production" && !isDemoMode();
  if (production && !configuredSecret) {
    throw new ConfigurationError("SESSION_SECRET is required in production.");
  }
  if (configuredSecret && configuredSecret.length < 32) {
    throw new ConfigurationError("SESSION_SECRET must contain at least 32 characters.");
  }
  return {
    appPassword,
    sessionSecret: configuredSecret || appPassword,
  };
};

export const getYahooConfig = () => ({
  clientId: required("YAHOO_CLIENT_ID"),
  clientSecret: required("YAHOO_CLIENT_SECRET"),
  refreshToken: required("YAHOO_REFRESH_TOKEN"),
  redirectUri: required("YAHOO_REDIRECT_URI"),
});
