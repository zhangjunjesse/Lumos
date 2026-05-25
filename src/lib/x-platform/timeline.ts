import { ensureScraper } from './scraper';
import {
  collectTweetHits,
  DEFAULT_X_SMALL_COUNT,
  MAX_X_USER_TIMELINE_COLLECT_COUNT,
  normalizeXCollectCount,
} from './collection';
import type { RawTweetLike } from './tweet-mapper';
import type { XSearchResult } from './types';

/**
 * 拉取某个用户的最近推文。screenName 是 @ 句柄(无 @),内部走 the-convocation
 * 的 getTweets,会自动用 screen_name → user_id 解析。
 */
export async function readUserTweets(
  screenName: string,
  opts: { count?: number; timeoutMs?: number; allowPartialOnTimeout?: boolean } = {},
): Promise<XSearchResult> {
  const cleaned = (screenName || '').trim().replace(/^@/, '');
  if (!cleaned) throw new Error('screenName 不能为空');
  const count = normalizeXCollectCount(
    opts.count,
    DEFAULT_X_SMALL_COUNT,
    MAX_X_USER_TIMELINE_COLLECT_COUNT,
  );

  const scraper = await ensureScraper();
  const iterator = scraper.getTweets(cleaned, count)[Symbol.asyncIterator]();
  const collected = await collectTweetHits(iterator as AsyncIterator<RawTweetLike>, {
    count,
    defaultCount: DEFAULT_X_SMALL_COUNT,
    maxCount: MAX_X_USER_TIMELINE_COLLECT_COUNT,
    timeoutMs: opts.timeoutMs,
    label: 'X 用户时间线',
    allowPartialOnTimeout: opts.allowPartialOnTimeout,
  });
  return { query: `__user_${cleaned}__`, ...collected };
}
