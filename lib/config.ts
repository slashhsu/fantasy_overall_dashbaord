const numberFromEnv = (name: string, fallback: number, minimum: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
};

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
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
  return {
    appPassword,
    sessionSecret: process.env.SESSION_SECRET?.trim() || appPassword,
  };
};

export const getYahooConfig = () => ({
  clientId: required("YAHOO_CLIENT_ID"),
  clientSecret: required("YAHOO_CLIENT_SECRET"),
  refreshToken: required("YAHOO_REFRESH_TOKEN"),
  redirectUri: required("YAHOO_REDIRECT_URI"),
});
