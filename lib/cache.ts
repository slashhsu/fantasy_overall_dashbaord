interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const globalCache = globalThis as typeof globalThis & {
  __fantasyCache?: Map<string, CacheEntry<unknown>>;
};

const cache = globalCache.__fantasyCache ?? new Map<string, CacheEntry<unknown>>();
globalCache.__fantasyCache = cache;

export const getCached = <T>(key: string): T | undefined => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
};

export const setCached = <T>(key: string, value: T, ttlSeconds: number) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
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
): Promise<{ value: T; cached: boolean }> => {
  if (!forceRefresh) {
    const existing = getCached<T>(key);
    if (existing !== undefined) return { value: existing, cached: true };
  }

  const value = await loader();
  if (ttlSeconds > 0) setCached(key, value, ttlSeconds);
  return { value, cached: false };
};
