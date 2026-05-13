/**
 * X (Twitter) DeepSearch adapter.
 *
 * search:走 lib/x-platform/search → @the-convocation/twitter-scraper,返回搜
 * 索结果。每个 item 的 snippet 后面追加 ❤/🔁/💬 指标,extra 带完整 metric
 * + media,AI 看到的搜索列表自带数据指标不用再 extract 才知道。
 *
 * extract:走 lib/x-platform/thread → 拿单条推文 + 同 thread 下评论列表,拼
 * 成 markdown。AI 抽到的"完整推文"含原文 / 媒体 / 指标 / 评论,而不是 oembed
 * 那种只有 280 字摘要。
 */

import { searchTweets } from '@/lib/x-platform/search';
import { getTweetById, getTweetReplies } from '@/lib/x-platform/thread';
import { getAuthStatus } from '@/lib/x-platform/auth';
import { isXAuthExpiredError } from '@/lib/x-platform/auth-error';
import { formatTweetMetrics } from '@/lib/x-platform/tweet-mapper';
import type {
  AdapterContext,
  AdapterExtractResult,
  AdapterLoginProbe,
  AdapterSearchResult,
  SiteAdapter,
} from '../adapter-types';
import type { XSearchHit } from '@/lib/x-platform/types';

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function extractTweetId(url: string): string {
  const m = url.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/);
  return m ? m[1] : '';
}

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildMetrics(hit: XSearchHit) {
  return {
    likeCount: hit.likeCount,
    retweetCount: hit.retweetCount,
    replyCount: hit.replyCount,
    bookmarkCount: hit.bookmarkCount,
    quoteCount: hit.quoteCount,
    viewCount: hit.viewCount,
  };
}

function buildTweetStructuredData(hit: XSearchHit) {
  return {
    tweetId: hit.id,
    url: hit.url,
    text: hit.text,
    authorId: hit.authorId,
    authorScreenName: hit.authorScreenName,
    authorName: hit.authorName,
    conversationId: hit.conversationId,
    createdAt: hit.createdAt,
    metrics: buildMetrics(hit),
    likeCount: hit.likeCount,
    retweetCount: hit.retweetCount,
    replyCount: hit.replyCount,
    bookmarkCount: hit.bookmarkCount,
    quoteCount: hit.quoteCount,
    viewCount: hit.viewCount,
    photoUrls: hit.photoUrls,
    videoPreviewUrls: hit.videoPreviewUrls,
  };
}

async function probeLogin(): Promise<AdapterLoginProbe> {
  try {
    const status = await getAuthStatus({ refreshFromGraphQL: false });
    if (!status.loggedIn) {
      return { siteKey: 'x', loginState: 'missing', blockingReason: 'X 未登录,前往「服务 → X」登录', lastError: '' };
    }
    return { siteKey: 'x', loginState: 'connected', blockingReason: '', lastError: '' };
  } catch (err) {
    if (isXAuthExpiredError(err)) {
      return { siteKey: 'x', loginState: 'expired', blockingReason: 'X 登录已过期', lastError: '' };
    }
    return {
      siteKey: 'x', loginState: 'error', blockingReason: 'X 状态探测失败',
      lastError: err instanceof Error ? err.message : String(err),
    };
  }
}

async function search(_ctx: AdapterContext, query: string, maxResults: number): Promise<AdapterSearchResult> {
  void _ctx;
  const limit = Math.max(1, Math.min(50, maxResults));
  const result = await searchTweets(query, { count: limit });
  const structuredItems = result.hits.map(buildTweetStructuredData);
  const items = result.hits.map((hit) => {
    const metrics = formatTweetMetrics(hit);
    const snippet = metrics
      ? `${truncate(hit.text, 240)}\n— ${metrics}`
      : truncate(hit.text, 280);
    return {
      url: hit.url,
      title: hit.authorName
        ? `${hit.authorName} (@${hit.authorScreenName})`
        : `@${hit.authorScreenName || hit.authorId}`,
      snippet,
      voteCount: hit.likeCount,
      extra: {
        authorScreenName: hit.authorScreenName,
        authorName: hit.authorName,
        tweetId: hit.id,
        conversationId: hit.conversationId,
        createdAt: hit.createdAt,
        likeCount: hit.likeCount,
        retweetCount: hit.retweetCount,
        replyCount: hit.replyCount,
        viewCount: hit.viewCount,
        bookmarkCount: hit.bookmarkCount,
        quoteCount: hit.quoteCount,
        photoUrls: hit.photoUrls,
        videoPreviewUrls: hit.videoPreviewUrls,
        metrics: buildMetrics(hit),
      },
    };
  });
  return {
    items,
    sourceUrl: `https://x.com/search?q=${encodeURIComponent(query)}`,
    structuredData: {
      adapter: 'x',
      pageType: 'search',
      resultCount: items.length,
      items: structuredItems,
    },
  };
}

function buildTweetMarkdown(hit: XSearchHit): string {
  const metrics = formatTweetMetrics(hit);
  const head = `**${hit.authorName || hit.authorScreenName}** (@${hit.authorScreenName})`;
  const meta = [formatTimestamp(hit.createdAt), metrics].filter(Boolean).join(' · ');
  const lines: string[] = [head];
  if (meta) lines.push(`*${meta}*`);
  lines.push('');
  lines.push(hit.text);
  if (hit.photoUrls.length > 0) {
    lines.push('');
    for (const url of hit.photoUrls) lines.push(`📷 ${url}`);
  }
  if (hit.videoPreviewUrls.length > 0) {
    lines.push('');
    for (const url of hit.videoPreviewUrls) lines.push(`🎬 ${url}`);
  }
  return lines.join('\n');
}

async function extract(ctx: AdapterContext, url: string): Promise<AdapterExtractResult> {
  void ctx;
  const tweetId = extractTweetId(url);
  if (!tweetId) return failedExtract(url, '', 'URL 不含 tweet id');

  let main: XSearchHit | null = null;
  try {
    main = await getTweetById(tweetId);
  } catch (err) {
    return failedExtract(url, tweetId, err instanceof Error ? err.message : String(err));
  }
  if (!main) return failedExtract(url, tweetId, 'getTweet 返回空');

  let replies: XSearchHit[] = [];
  try {
    replies = await getTweetReplies(main.conversationId || tweetId, {
      count: 20,
      excludeId: tweetId,
    });
  } catch {
    // 评论拿不到不影响主推抽取(可能 thread 锁定 / 反爬偶发)
    replies = [];
  }

  const sections: string[] = [buildTweetMarkdown(main)];
  if (replies.length > 0) {
    sections.push('\n---\n');
    sections.push(`## 评论 / Thread (${replies.length} 条)\n`);
    for (const r of replies) sections.push(buildTweetMarkdown(r));
  }
  const contentText = sections.join('\n\n');
  const title = main.authorName
    ? `${main.authorName} (@${main.authorScreenName})`
    : `@${main.authorScreenName || tweetId}`;

  return {
    url,
    title,
    contentText,
    contentState: 'full',
    snippet: truncate(main.text, 600),
    evidenceCount: 1 + replies.length,
    screenshotPath: null,
    structuredData: {
      adapter: 'x',
      pageType: 'tweet_detail',
      tweetId,
      conversationId: main.conversationId,
      authorScreenName: main.authorScreenName,
      authorName: main.authorName,
      createdAt: main.createdAt,
      metrics: buildMetrics(main),
      likeCount: main.likeCount,
      retweetCount: main.retweetCount,
      replyCount: main.replyCount,
      viewCount: main.viewCount,
      bookmarkCount: main.bookmarkCount,
      quoteCount: main.quoteCount,
      photoUrls: main.photoUrls,
      videoPreviewUrls: main.videoPreviewUrls,
      replyCountFetched: replies.length,
    },
  };
}

function failedExtract(url: string, tweetId: string, reason: string): AdapterExtractResult {
  return {
    url,
    title: `推文 ${tweetId || '(未知)'}`,
    contentText: '',
    contentState: 'failed',
    snippet: '',
    evidenceCount: 0,
    screenshotPath: null,
    structuredData: { adapter: 'x', pageType: 'tweet_detail', tweetId, error: reason },
  };
}

export const xAdapter: SiteAdapter = {
  siteKey: 'x',
  probeLogin,
  search,
  extract,
};
