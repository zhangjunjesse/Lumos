import type { ProviderHealthResult } from './provider-health-types';

const CACHE_GLOBAL_KEY = '__lumosProviderHealthCache__';
const DEFAULT_TTL_MS = 2 * 60 * 1000;

interface ProviderHealthCacheEntry {
  result: ProviderHealthResult;
  expiresAt: number;
}

function getCache(): Map<string, ProviderHealthCacheEntry> {
  const globalRef = globalThis as Record<string, unknown>;
  if (!globalRef[CACHE_GLOBAL_KEY]) {
    globalRef[CACHE_GLOBAL_KEY] = new Map<string, ProviderHealthCacheEntry>();
  }
  return globalRef[CACHE_GLOBAL_KEY] as Map<string, ProviderHealthCacheEntry>;
}

function cacheKey(providerId: string, model: string): string {
  return `${providerId.trim()}::${model.trim()}`;
}

export function getCachedProviderHealth(
  providerId: string,
  model: string,
): ProviderHealthResult | null {
  const key = cacheKey(providerId, model);
  const entry = getCache().get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    getCache().delete(key);
    return null;
  }
  return { ...entry.result, cached: true };
}

export function setCachedProviderHealth(
  result: ProviderHealthResult,
  ttlMs = DEFAULT_TTL_MS,
): void {
  getCache().set(cacheKey(result.providerId, result.model), {
    result: { ...result, cached: false },
    expiresAt: Date.now() + Math.max(5_000, ttlMs),
  });
}

export function clearProviderHealthCache(providerId?: string): void {
  const cache = getCache();
  const normalizedProviderId = providerId?.trim();
  if (!normalizedProviderId) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(`${normalizedProviderId}::`)) {
      cache.delete(key);
    }
  }
}

