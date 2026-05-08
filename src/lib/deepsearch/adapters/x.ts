/**
 * X (Twitter) DeepSearch adapter.
 *
 * 和其他 adapter 不同, X 必须登录才能搜索 — 直接调 src/lib/x-platform/search.ts
 * (走我们自己持有的 cookies + GraphQL bearer), 不用 ctx.fetch (那是 Electron
 * session, 我们的 X cookies 在独立文件里)。
 *
 * extract 走 X 官方 oembed: 不要登录, 返回 HTML 含完整推文。比 GraphQL
 * TweetResultByRestId 更稳定 (query_id 不会变)。
 */

import { searchTweets } from '@/lib/x-platform/search';
import { getAuthStatus } from '@/lib/x-platform/auth';
import { isXAuthExpiredError } from '@/lib/x-platform/auth-error';
import type {
  AdapterContext,
  AdapterExtractResult,
  AdapterLoginProbe,
  AdapterSearchResult,
  SiteAdapter,
} from '../adapter-types';

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function extractTweetId(url: string): string {
  const m = url.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/);
  return m ? m[1] : '';
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
  void _ctx; // ctx 用不上, X cookie 自己持有
  const limit = Math.max(1, Math.min(50, maxResults));
  const result = await searchTweets(query, { count: limit });
  const items = result.hits.map((hit) => ({
    url: hit.url,
    title: hit.authorName
      ? `${hit.authorName} (@${hit.authorScreenName})`
      : `@${hit.authorScreenName || hit.authorId}`,
    snippet: truncate(hit.text, 280),
    extra: {
      authorScreenName: hit.authorScreenName,
      authorName: hit.authorName,
      tweetId: hit.id,
      createdAt: hit.createdAt,
      likeCount: hit.likeCount,
      retweetCount: hit.retweetCount,
      replyCount: hit.replyCount,
    },
  }));
  return {
    items,
    sourceUrl: `https://x.com/search?q=${encodeURIComponent(query)}`,
    structuredData: { adapter: 'x', pageType: 'search', resultCount: items.length },
  };
}

async function extract(ctx: AdapterContext, url: string): Promise<AdapterExtractResult> {
  const tweetId = extractTweetId(url);
  const oembedUrl = `https://publish.x.com/oembed?url=${encodeURIComponent(url)}&omit_script=1&dnt=true`;

  try {
    const resp = await ctx.fetch(oembedUrl, {
      headers: { 'Accept': 'application/json' },
    });
    if (resp.status >= 200 && resp.status < 300) {
      const data = JSON.parse(resp.html) as {
        author_name?: string;
        author_url?: string;
        html?: string;
      };
      const html = data?.html || '';
      const tweetText = strip(html);
      const author = data?.author_name || '';
      const title = author ? `${author} - X` : `推文 ${tweetId}`;
      return {
        url,
        title,
        contentText: tweetText,
        contentState: tweetText.length > 0 ? 'full' : 'failed',
        snippet: truncate(tweetText, 280),
        evidenceCount: tweetText ? 1 : 0,
        screenshotPath: null,
        structuredData: {
          adapter: 'x',
          pageType: 'tweet_detail',
          tweetId,
          authorUrl: data?.author_url,
          authorName: author,
        },
      };
    }
    return failedExtract(url, tweetId, `oembed HTTP ${resp.status}`);
  } catch (err) {
    return failedExtract(url, tweetId, err instanceof Error ? err.message : String(err));
  }
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
