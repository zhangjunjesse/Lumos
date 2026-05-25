/**
 * 单条推文 + thread/评论 抓取。给 DeepSearch x adapter.extract 用:
 *   - getTweetById(id) 拿主推完整内容
 *   - getTweetReplies(conversationId, count) 走 search "conversation_id:..."
 *     拉同一 thread 下所有 reply (含同作者续推 + 别人评论)
 *
 * 这样 DeepSearch 抽某条推文时,AI 看到的不只是 280 字摘要,而是"主推 + 评论
 * 列表 + 指标 + 媒体"的完整 thread context。
 */

import { SearchMode } from '@the-convocation/twitter-scraper';
import { ensureScraper } from './scraper';
import { normalizeXReadTimeoutMs, withXTimeout } from './iterator-timeout';
import {
  collectTweetHits,
  DEFAULT_X_SMALL_COUNT,
  MAX_X_REPLIES_COLLECT_COUNT,
  normalizeXCollectCount,
} from './collection';
import { mapTweetToHit, type RawTweetLike } from './tweet-mapper';
import type { XSearchHit, XSearchResult } from './types';

export async function getTweetById(
  id: string,
  opts: { timeoutMs?: number } = {},
): Promise<XSearchHit | null> {
  const cleaned = (id || '').trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const timeoutMs = normalizeXReadTimeoutMs(opts.timeoutMs);
  const scraper = await ensureScraper();
  const t = await withXTimeout(Promise.resolve(scraper.getTweet(cleaned)), timeoutMs, 'X 推文详情');
  if (!t) return null;
  return mapTweetToHit(t as RawTweetLike);
}

/**
 * 拉指定 thread 的回复(不含主推自己)。X 的 conversation 是公开的,不要登录,
 * 但 the-convocation 内部的 search endpoint 走 graphql 需要登录态。
 */
export async function getTweetReplies(
  conversationId: string,
  opts: {
    count?: number;
    excludeId?: string;
    timeoutMs?: number;
    allowPartialOnTimeout?: boolean;
  } = {},
): Promise<XSearchHit[]> {
  const result = await readTweetReplies(conversationId, opts);
  return result.hits;
}

export async function readTweetReplies(
  conversationId: string,
  opts: {
    count?: number;
    excludeId?: string;
    timeoutMs?: number;
    allowPartialOnTimeout?: boolean;
  } = {},
): Promise<XSearchResult> {
  const cleaned = (conversationId || '').trim();
  if (!/^\d+$/.test(cleaned)) return { query: `conversation_id:${cleaned}`, hits: [] };
  const count = normalizeXCollectCount(opts.count, DEFAULT_X_SMALL_COUNT, MAX_X_REPLIES_COLLECT_COUNT);
  const excludeId = opts.excludeId || cleaned;

  const scraper = await ensureScraper();
  const iterator = scraper.searchTweets(`conversation_id:${cleaned}`, count + 1, SearchMode.Latest)[Symbol.asyncIterator]();
  const collected = await collectTweetHits(iterator as AsyncIterator<RawTweetLike>, {
    count,
    defaultCount: DEFAULT_X_SMALL_COUNT,
    maxCount: MAX_X_REPLIES_COLLECT_COUNT,
    timeoutMs: opts.timeoutMs,
    label: 'X 推文评论',
    allowPartialOnTimeout: opts.allowPartialOnTimeout,
    excludeIds: [excludeId],
  });
  // 时间倒序,主线 thread 从近到远
  return {
    query: `conversation_id:${cleaned}`,
    ...collected,
    hits: collected.hits.sort((a, b) => b.createdAt - a.createdAt),
  };
}
