import { SearchMode } from '@the-convocation/twitter-scraper';
import { ensureScraper } from './scraper';
import {
  collectTweetHits,
  DEFAULT_X_SMALL_COUNT,
  MAX_X_SEARCH_COLLECT_COUNT,
  normalizeXCollectCount,
} from './collection';
import { getTweetById } from './thread';
import type { RawTweetLike } from './tweet-mapper';
import type { XSearchResult } from './types';

const X_STATUS_ID_PATTERN = /^\d{15,22}$/;

function getStatusId(query: string): string | null {
  if (X_STATUS_ID_PATTERN.test(query)) return query;
  try {
    const url = new URL(query);
    const host = url.hostname.toLowerCase();
    if (host !== 'x.com' && !host.endsWith('.x.com')
      && host !== 'twitter.com' && !host.endsWith('.twitter.com')) return null;
    return url.pathname.match(/\/status\/(\d{15,22})(?:\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * 搜索推文。mode 默认 Top(相关性),要按时间倒序传 'Latest'。
 */
export async function searchTweets(
  query: string,
  opts: {
    count?: number;
    mode?: 'Top' | 'Latest' | 'Photos' | 'Videos' | 'Users';
    timeoutMs?: number;
    allowPartialOnTimeout?: boolean;
  } = {},
): Promise<XSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { query: trimmed, hits: [] };
  const statusId = getStatusId(trimmed);
  if (statusId) {
    const hit = await getTweetById(statusId, { timeoutMs: opts.timeoutMs });
    if (!hit) throw new Error(`X 推文不存在或当前登录态无权访问: ${statusId}`);
    return { query: trimmed, hits: [hit], requestedCount: 1, returnedCount: 1 };
  }
  const count = normalizeXCollectCount(opts.count, DEFAULT_X_SMALL_COUNT, MAX_X_SEARCH_COLLECT_COUNT);
  const modeName = opts.mode ?? 'Top';
  const mode = SearchMode[modeName as keyof typeof SearchMode] ?? SearchMode.Top;

  const scraper = await ensureScraper();
  const iterator = scraper.searchTweets(trimmed, count, mode)[Symbol.asyncIterator]();
  const collected = await collectTweetHits(iterator as AsyncIterator<RawTweetLike>, {
    count,
    defaultCount: DEFAULT_X_SMALL_COUNT,
    maxCount: MAX_X_SEARCH_COLLECT_COUNT,
    timeoutMs: opts.timeoutMs,
    label: 'X 搜索',
    allowPartialOnTimeout: opts.allowPartialOnTimeout,
  });
  return { query: trimmed, ...collected };
}
