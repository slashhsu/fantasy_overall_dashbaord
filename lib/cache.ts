import { recordMetric } from "@/lib/usage-metrics";
import { recordUpdate } from "@/lib/update-status";

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
  touchedAt: number;
}

const MAX_ENTRIES = 250;
const DEFAULT_STALE_SECONDS = 3_600;

const globalCache = globalThis as typeof globalThis & {
  __fantasyCache?: Map<string, CacheEntry<unknown>>;
  __fantasyInflight?: Map<string, Promise<unknown>>;
};

const cache = globalCache.__fantasyCache ?? new Map<string, CacheEntry<unknown>>();
globalCache.__fantasyCache = cache;
const inflight = globalCache.__fantasyInflight ?? new Map<string, Promise<unknown>>();
globalCache.__fantasyInflight = inflight;

const prune = () => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.staleUntil <= now) cache.delete(key);
  }
  if (cache.size <= MAX_ENTRIES) return;
  const oldest = [...cache].sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  oldest.slice(0, cache.size - MAX_ENTRIES).forEach(([key]) => cache.delete(key));
};

const cacheEntry = <T>(key: string) => {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  entry.touchedAt = Date.now();
  cache.delete(key);
  cache.set(key, entry as CacheEntry<unknown>);
  return entry;
};

export const getCached = <T>(key: string): T | undefined => {
  const entry = cacheEntry<T>(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    return undefined;
  }
  return entry.value as T;
};

export const setCached = <T>(key: string, value: T, ttlSeconds: number, staleSeconds = DEFAULT_STALE_SECONDS) => {
  const now = Date.now();
  cache.set(key, {
    value,
    fetchedAt: now,
    expiresAt: now + ttlSeconds * 1000,
    staleUntil: now + (ttlSeconds + staleSeconds) * 1000,
    touchedAt: now,
  });
  prune();
};

export const deleteCachedByPrefix = (prefix: string) => {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
};

export const withCache = async <T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  forceRefresh = false,
  options: { staleIfErrorSeconds?: number } = {},
): Promise<{ value: T; cached: boolean; stale: boolean }> => {
  type CacheResult = { value: T; cached: boolean; stale: boolean };
  const report = (result: CacheResult): CacheResult => {
    const entry = cache.get(key);
    if (entry) recordUpdate({ fetchedAt: new Date(entry.fetchedAt).toISOString(), stale: result.stale,
      nextRefreshAt: new Date(entry.fetchedAt + 60_000).toISOString() });
    return result;
  };
  const existingPromise = inflight.get(key) as Promise<CacheResult> | undefined;
  if (existingPromise) { recordMetric("mergedRequests"); return report(await existingPromise); }
  const existing = cacheEntry<T>(key);
  const cooling = existing && Date.now() - existing.fetchedAt < 60_000;
  if (existing && existing.staleUntil > Date.now() &&
      ((!forceRefresh && existing.expiresAt > Date.now()) || (forceRefresh && cooling))) {
    recordMetric(forceRefresh ? "cooldownHits" : "cacheHits");
    return report({ value: existing.value, cached: true, stale: existing.expiresAt <= Date.now() });
  }
  const pending = (async (): Promise<CacheResult> => {
    try {
      const value = await loader();
      if (ttlSeconds > 0) setCached(key, value, ttlSeconds, options.staleIfErrorSeconds);
      return { value, cached: false, stale: false };
    } catch (error) {
      const stale = cacheEntry<T>(key);
      if (stale && stale.staleUntil > Date.now()) {
        recordMetric("cacheHits");
        return { value: stale.value, cached: true, stale: true };
      }
      throw error;
    }
  })();
  inflight.set(key, pending);
  try {
    return report(await pending);
  } finally {
    if (inflight.get(key) === pending) inflight.delete(key);
  }
};

export const cacheSizeForTests = () => cache.size;

export const resetCacheForTests = () => {
  cache.clear();
  inflight.clear();
};
