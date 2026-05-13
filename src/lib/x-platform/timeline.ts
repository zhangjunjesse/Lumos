import { ensureScraper } from './scraper';
import { mapTweetToHit, type RawTweetLike } from './tweet-mapper';
import type { XSearchHit, XSearchResult } from './types';

/**
 * 拉取某个用户的最近推文。screenName 是 @ 句柄(无 @),内部走 the-convocation
 * 的 getTweets,会自动用 screen_name → user_id 解析。
 */
export async function readUserTweets(
  screenName: string,
  opts: { count?: number } = {},
): Promise<XSearchResult> {
  const cleaned = (screenName || '').trim().replace(/^@/, '');
  if (!cleaned) throw new Error('screenName 不能为空');
  const count = Math.max(1, Math.min(50, opts.count ?? 20));

  const scraper = await ensureScraper();
  const hits: XSearchHit[] = [];
  for await (const t of scraper.getTweets(cleaned, count)) {
    const hit = mapTweetToHit(t as RawTweetLike);
    if (hit) hits.push(hit);
    if (hits.length >= count) break;
  }
  return { query: `__user_${cleaned}__`, hits };
}
