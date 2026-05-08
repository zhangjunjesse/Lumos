/**
 * X GraphQL timeline 响应展平: 把嵌套巨深的 timeline_response 拍成 XSearchHit[]。
 *
 * X 的 timeline 用 instructions[] + entries[] + content union 表达,各种推文类型
 * (Tweet / TweetWithVisibilityResults / 广告 / 模块) 嵌套不同。我们只关心
 * 普通 Tweet, 其它静默丢弃。
 */

import type { XSearchHit } from './types';

interface TweetLegacy {
  id_str?: string;
  full_text?: string;
  created_at?: string;
  user_id_str?: string;
  favorite_count?: number;
  retweet_count?: number;
  reply_count?: number;
  in_reply_to_status_id_str?: string;
}

interface UserLegacy {
  screen_name?: string;
  name?: string;
}

interface TweetResultCore {
  rest_id?: string;
  legacy?: TweetLegacy;
  core?: { user_results?: { result?: { rest_id?: string; legacy?: UserLegacy } } };
}

interface TweetResultsWrapper {
  result?: TweetResultCore | { tweet?: TweetResultCore };
}

interface ItemContent {
  itemType?: string;
  tweet_results?: TweetResultsWrapper;
}

interface Entry {
  entryId?: string;
  content?: {
    entryType?: string;
    itemContent?: ItemContent;
    items?: Array<{ item?: { itemContent?: ItemContent } }>;
  };
}

interface Instruction {
  type?: string;
  entries?: Entry[];
}

export interface TimelineResponse {
  // X 的 timeline 在不同 operation 下嵌套不同, 调用方传具体路径上的 instructions[]。
  instructions?: Instruction[];
}

function unwrapResult(result: TweetResultsWrapper['result']): TweetResultCore | null {
  if (!result) return null;
  if ('tweet' in result && result.tweet) return result.tweet;
  return result as TweetResultCore;
}

function tweetLegacyToHit(tweet: TweetResultCore): XSearchHit | null {
  const legacy = tweet.legacy;
  if (!legacy?.id_str || !legacy.full_text) return null;
  const userResult = tweet.core?.user_results?.result;
  const screenName = userResult?.legacy?.screen_name || '';
  return {
    id: legacy.id_str,
    authorId: legacy.user_id_str || userResult?.rest_id || '',
    authorScreenName: screenName,
    authorName: userResult?.legacy?.name || '',
    text: legacy.full_text,
    createdAt: legacy.created_at ? Date.parse(legacy.created_at) : 0,
    likeCount: legacy.favorite_count ?? 0,
    retweetCount: legacy.retweet_count ?? 0,
    replyCount: legacy.reply_count ?? 0,
    url: screenName ? `https://x.com/${screenName}/status/${legacy.id_str}` : `https://x.com/i/status/${legacy.id_str}`,
  };
}

export function extractHits(timeline: TimelineResponse, opts: { cursorPrefix?: string } = {}): { hits: XSearchHit[]; cursor?: string } {
  const hits: XSearchHit[] = [];
  let cursor: string | undefined;
  const cursorPrefix = opts.cursorPrefix || 'cursor-bottom';
  for (const instruction of timeline.instructions ?? []) {
    if (!instruction.entries) continue;
    for (const entry of instruction.entries) {
      // cursor 在 entryId 形如 "cursor-bottom-..." 的 entry 上
      if (entry.entryId && entry.entryId.startsWith(cursorPrefix)) {
        // X 的 cursor 通常埋在 content.itemContent.value 里, 但不同 op 嵌套不一,
        // 只挑能识别到的: itemContent.itemType === 'TimelineTimelineCursor' 时
        // value 字段在 itemContent 上 (DTO 类型省略,运行时拿)。
        const cursorValue = (entry.content?.itemContent as { value?: string } | undefined)?.value;
        if (cursorValue) cursor = cursorValue;
        continue;
      }
      const item = entry.content?.itemContent;
      if (item?.itemType === 'TimelineTweet' && item.tweet_results) {
        const t = unwrapResult(item.tweet_results.result);
        if (t) {
          const hit = tweetLegacyToHit(t);
          if (hit) hits.push(hit);
        }
      }
      // module 类型 (e.g. SearchTimeline 里的 cluster): 展开它的 items
      for (const sub of entry.content?.items ?? []) {
        const subItem = sub.item?.itemContent;
        if (subItem?.itemType === 'TimelineTweet' && subItem.tweet_results) {
          const t = unwrapResult(subItem.tweet_results.result);
          if (t) {
            const hit = tweetLegacyToHit(t);
            if (hit) hits.push(hit);
          }
        }
      }
    }
  }
  return { hits, cursor };
}
