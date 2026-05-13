/**
 * @the-convocation/twitter-scraper 的 Tweet 对象 → 我们的 XSearchHit 映射。
 * search.ts / timeline.ts / DeepSearch x adapter 都走这一个 mapper,保证字段
 * 名一致,后续加字段只改一处。
 */

import type { XSearchHit } from './types';

export interface RawTweetLike {
  id?: string;
  username?: string;
  name?: string;
  userId?: string;
  text?: string;
  timestamp?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  views?: number;
  bookmarkCount?: number;
  quoteCount?: number;
  conversationId?: string;
  permanentUrl?: string;
  photos?: Array<{ url?: string }>;
  videos?: Array<{ url?: string; preview?: string }>;
}

export function mapTweetToHit(t: RawTweetLike): XSearchHit | null {
  if (!t.id) return null;
  const screen = t.username || '';
  return {
    id: t.id,
    authorId: t.userId || '',
    authorScreenName: screen,
    authorName: t.name || '',
    text: t.text || '',
    createdAt: t.timestamp ? t.timestamp * 1000 : 0,
    likeCount: t.likes ?? 0,
    retweetCount: t.retweets ?? 0,
    replyCount: t.replies ?? 0,
    viewCount: t.views ?? 0,
    bookmarkCount: t.bookmarkCount ?? 0,
    quoteCount: t.quoteCount ?? 0,
    conversationId: t.conversationId || t.id,
    photoUrls: (t.photos || []).map((p) => p?.url || '').filter(Boolean),
    videoPreviewUrls: (t.videos || []).map((v) => v?.preview || v?.url || '').filter(Boolean),
    url: t.permanentUrl || (screen && t.id ? `https://x.com/${screen}/status/${t.id}` : `https://x.com/i/status/${t.id}`),
  };
}

/** 把指标拼成紧凑展示字符串,UI / AI 一眼能扫到。 */
export function formatTweetMetrics(hit: XSearchHit): string {
  const parts: string[] = [];
  if (hit.likeCount) parts.push(`❤${formatCount(hit.likeCount)}`);
  if (hit.retweetCount) parts.push(`🔁${formatCount(hit.retweetCount)}`);
  if (hit.replyCount) parts.push(`💬${formatCount(hit.replyCount)}`);
  if (hit.bookmarkCount) parts.push(`🔖${formatCount(hit.bookmarkCount)}`);
  if (hit.quoteCount) parts.push(`❝${formatCount(hit.quoteCount)}`);
  if (hit.viewCount) parts.push(`👁${formatCount(hit.viewCount)}`);
  return parts.join(' ');
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
