import {
  DEFAULT_X_READ_TIMEOUT_MS,
  MAX_X_READ_TIMEOUT_MS,
  isXReadTimeoutError,
  nextWithXTimeout,
  normalizeXReadTimeoutMs,
} from './iterator-timeout';
import { mapTweetToHit, type RawTweetLike } from './tweet-mapper';
import type { XCollectionMeta, XSearchHit } from './types';

export const DEFAULT_X_SMALL_COUNT = 20;
export const MAX_X_SEARCH_COLLECT_COUNT = 1_000;
export const MAX_X_USER_TIMELINE_COLLECT_COUNT = 1_000;
export const MAX_X_REPLIES_COLLECT_COUNT = 500;

export interface CollectTweetHitsOptions {
  count?: number;
  defaultCount?: number;
  maxCount: number;
  timeoutMs?: number;
  label: string;
  allowPartialOnTimeout?: boolean;
  excludeIds?: Iterable<string>;
}

export interface CollectedTweetHits extends XCollectionMeta {
  hits: XSearchHit[];
}

export function normalizeXCollectCount(
  count: number | undefined,
  defaultCount: number,
  maxCount: number,
): number {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    return defaultCount;
  }
  return Math.max(1, Math.min(maxCount, Math.floor(count)));
}

function defaultCollectionTimeoutMs(requestedCount: number): number {
  if (requestedCount <= 50) return DEFAULT_X_READ_TIMEOUT_MS;
  const estimatedPages = Math.ceil(requestedCount / 50);
  return Math.min(MAX_X_READ_TIMEOUT_MS, Math.max(DEFAULT_X_READ_TIMEOUT_MS, estimatedPages * 15_000));
}

export async function collectTweetHits(
  iterator: AsyncIterator<RawTweetLike>,
  options: CollectTweetHitsOptions,
): Promise<CollectedTweetHits> {
  const startedAt = Date.now();
  const requestedCount = normalizeXCollectCount(
    options.count,
    options.defaultCount ?? DEFAULT_X_SMALL_COUNT,
    options.maxCount,
  );
  const timeoutMs = normalizeXReadTimeoutMs(options.timeoutMs ?? defaultCollectionTimeoutMs(requestedCount));
  const deadline = startedAt + timeoutMs;
  const excludeIds = new Set(options.excludeIds ?? []);
  const seenIds = new Set<string>(excludeIds);
  const hits: XSearchHit[] = [];
  let exhausted = false;
  let partial = false;
  let timedOut = false;
  let error: string | undefined;

  try {
    while (hits.length < requestedCount) {
      const next = await nextWithXTimeout(iterator, deadline - Date.now(), options.label);
      if (next.done) {
        exhausted = true;
        break;
      }
      const hit = mapTweetToHit(next.value);
      if (!hit || seenIds.has(hit.id)) continue;
      seenIds.add(hit.id);
      hits.push(hit);
    }
  } catch (err) {
    if (!isXReadTimeoutError(err) || !options.allowPartialOnTimeout) {
      throw err;
    }
    partial = true;
    timedOut = true;
    error = err instanceof Error ? err.message : String(err);
  } finally {
    if (!exhausted) {
      void iterator.return?.(undefined as never).catch(() => undefined);
    }
  }

  return {
    hits,
    requestedCount,
    returnedCount: hits.length,
    maxSupportedCount: options.maxCount,
    partial,
    timedOut,
    durationMs: Date.now() - startedAt,
    ...(error ? { error } : {}),
  };
}
