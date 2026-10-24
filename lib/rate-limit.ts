import "server-only";

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_KEYS = 500;

interface AttemptState {
  failures: number[];
  lockedUntil: number;
  touchedAt: number;
}

const globalRateLimits = globalThis as typeof globalThis & {
  __fantasyLoginLimits?: Map<string, AttemptState>;
};

const attempts = globalRateLimits.__fantasyLoginLimits ?? new Map<string, AttemptState>();
globalRateLimits.__fantasyLoginLimits = attempts;

const clientKey = (request: Request) => {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? "unknown";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const agent = request.headers.get("user-agent")?.slice(0, 120) ?? "unknown";
  return `${ip}:${agent}`;
};

const prune = (now: number) => {
  for (const [key, state] of attempts) {
    if (state.lockedUntil <= now && state.touchedAt < now - WINDOW_MS) attempts.delete(key);
  }
  if (attempts.size <= MAX_KEYS) return;
  const oldest = [...attempts].sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  oldest.slice(0, attempts.size - MAX_KEYS).forEach(([key]) => attempts.delete(key));
};

const stateFor = (request: Request, now = Date.now()) => {
  prune(now);
  const key = clientKey(request);
  const current = attempts.get(key) ?? { failures: [], lockedUntil: 0, touchedAt: now };
  current.failures = current.failures.filter((time) => time > now - WINDOW_MS);
  current.touchedAt = now;
  attempts.delete(key);
  attempts.set(key, current);
  return { key, state: current };
};

export const loginRateLimit = (request: Request) => {
  const now = Date.now();
  const { state } = stateFor(request, now);
  const blocked = state.lockedUntil > now;
  return {
    blocked,
    retryAfterSeconds: blocked ? Math.max(1, Math.ceil((state.lockedUntil - now) / 1000)) : 0,
    failureCount: state.failures.length,
  };
};

export const recordLoginFailure = async (request: Request) => {
  const now = Date.now();
  const { state } = stateFor(request, now);
  state.failures.push(now);
  if (state.failures.length >= MAX_FAILURES) state.lockedUntil = now + LOCK_MS;
  const delay = Math.min(2_000, 250 * 2 ** Math.max(0, state.failures.length - 1));
  await new Promise((resolve) => setTimeout(resolve, delay));
  return loginRateLimit(request);
};

export const clearLoginFailures = (request: Request) => attempts.delete(clientKey(request));

export const resetLoginRateLimitsForTests = () => attempts.clear();
