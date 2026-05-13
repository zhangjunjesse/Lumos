import { SearchMode } from '@the-convocation/twitter-scraper';
import { ensureScraper } from './scraper';
import { mapTweetToHit, type RawTweetLike } from './tweet-mapper';
import type { XSearchHit, XSearchResult } from './types';

/**
 * 搜索推文。mode 默认 Top(相关性),要按时间倒序传 'Latest'。
 */
export async function searchTweets(
  query: string,
  opts: { count?: number; mode?: 'Top' | 'Latest' | 'Photos' | 'Videos' | 'Users' } = {},
): Promise<XSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { query: trimmed, hits: [] };
  const count = Math.max(1, Math.min(50, opts.count ?? 20));
  const modeName = opts.mode ?? 'Top';
  const mode = SearchMode[modeName as keyof typeof SearchMode] ?? SearchMode.Top;

  const scraper = await ensureScraper();
  const hits: XSearchHit[] = [];
  for await (const t of scraper.searchTweets(trimmed, count, mode)) {
    const hit = mapTweetToHit(t as RawTweetLike);
    if (hit) hits.push(hit);
    if (hits.length >= count) break;
  }
  return { query: trimmed, hits };
}
