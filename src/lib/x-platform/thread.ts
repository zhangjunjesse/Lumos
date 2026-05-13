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
import { mapTweetToHit, type RawTweetLike } from './tweet-mapper';
import type { XSearchHit } from './types';

export async function getTweetById(id: string): Promise<XSearchHit | null> {
  const cleaned = (id || '').trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const scraper = await ensureScraper();
  const t = await scraper.getTweet(cleaned);
  if (!t) return null;
  return mapTweetToHit(t as RawTweetLike);
}

/**
 * 拉指定 thread 的回复(不含主推自己)。X 的 conversation 是公开的,不要登录,
 * 但 the-convocation 内部的 search endpoint 走 graphql 需要登录态。
 */
export async function getTweetReplies(
  conversationId: string,
  opts: { count?: number; excludeId?: string } = {},
): Promise<XSearchHit[]> {
  const cleaned = (conversationId || '').trim();
  if (!/^\d+$/.test(cleaned)) return [];
  const count = Math.max(1, Math.min(50, opts.count ?? 20));
  const excludeId = opts.excludeId || cleaned;

  const scraper = await ensureScraper();
  const out: XSearchHit[] = [];
  for await (const t of scraper.searchTweets(`conversation_id:${cleaned}`, count + 1, SearchMode.Latest)) {
    if ((t as RawTweetLike).id === excludeId) continue;
    const hit = mapTweetToHit(t as RawTweetLike);
    if (hit) out.push(hit);
    if (out.length >= count) break;
  }
  // 时间倒序,主线 thread 从近到远
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
