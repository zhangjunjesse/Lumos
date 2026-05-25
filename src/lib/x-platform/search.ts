import { SearchMode } from '@the-convocation/twitter-scraper';
import { ensureScraper } from './scraper';
import {
  collectTweetHits,
  DEFAULT_X_SMALL_COUNT,
  MAX_X_SEARCH_COLLECT_COUNT,
  normalizeXCollectCount,
} from './collection';
import type { RawTweetLike } from './tweet-mapper';
import type { XSearchResult } from './types';

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
