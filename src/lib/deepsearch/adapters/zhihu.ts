import type {
  SiteAdapter,
  AdapterContext,
  AdapterSearchResult,
  AdapterExtractResult,
} from '../adapter-types';
import { fetchZhihuBrowseHistory } from './zhihu-account';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function parseInitialState(html: string): Record<string, unknown> | null {
  const match = html.match(/<script[^>]*id="js-initialData"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getEntities(state: Record<string, unknown>): Record<string, unknown> {
  const init = state.initialState as Record<string, unknown> | undefined;
  return (init?.entities as Record<string, unknown>) || {};
}

// ---------------------------------------------------------------------------
// Search via API
// ---------------------------------------------------------------------------

async function searchViaApi(
  ctx: AdapterContext,
  query: string,
  maxResults: number,
): Promise<AdapterSearchResult> {
  const encoded = encodeURIComponent(query);
  const limit = Math.min(maxResults, 20);
  const apiUrl = `https://www.zhihu.com/api/v4/search_v3?t=general&q=${encoded}&correction=1&offset=0&limit=${limit}`;
  const sourceUrl = `https://www.zhihu.com/search?type=content&q=${encoded}`;

  const resp = await ctx.fetch(apiUrl, {
    headers: { Referer: sourceUrl },
  });

  const api = JSON.parse(resp.html) as {
    data?: Array<{
      type?: string;
      object?: {
        type?: string;
        url?: string;
        title?: string;
        excerpt?: string;
        content?: string;
        voteup_count?: number;
        question?: { id?: number; title?: string };
        id?: number;
      };
    }>;
  };

  const items = (api.data || [])
    .filter((r) => r.type === 'search_result' && r.object)
    .map((r) => {
      const obj = r.object!;
      const title = strip(obj.title || obj.question?.title || '');
      const rawUrl = obj.url || '';
      const url = resolveApiUrl(rawUrl, obj);
      const snippet = strip(obj.excerpt || obj.content || '');
      const voteCount = obj.voteup_count || 0;
      return { url, title, snippet: truncate(snippet, 300), voteCount };
    })
    .filter((item) => item.url && item.title);

  return {
    items,
    sourceUrl,
    structuredData: { adapter: 'zhihu', pageType: 'search_api', resultCount: items.length },
  };
}

function resolveApiUrl(
  rawUrl: string,
  obj: { type?: string; question?: { id?: number }; id?: number },
): string {
  // API returns urls like https://api.zhihu.com/answers/xxx — convert to web URLs
  if (obj.type === 'answer' && obj.question?.id) {
    return `https://www.zhihu.com/question/${obj.question.id}`;
  }
  if (obj.type === 'article' && obj.id) {
    return `https://zhuanlan.zhihu.com/p/${obj.id}`;
  }
  // Convert api.zhihu.com URLs
  const answerMatch = rawUrl.match(/api\.zhihu\.com\/answers\/(\d+)/);
  if (answerMatch) {
    return `https://www.zhihu.com/answer/${answerMatch[1]}`;
  }
  const questionMatch = rawUrl.match(/api\.zhihu\.com\/questions\/(\d+)/);
  if (questionMatch) {
    return `https://www.zhihu.com/question/${questionMatch[1]}`;
  }
  const articleMatch = rawUrl.match(/api\.zhihu\.com\/articles\/(\d+)/);
  if (articleMatch) {
    return `https://zhuanlan.zhihu.com/p/${articleMatch[1]}`;
  }
  return rawUrl;
}

// ---------------------------------------------------------------------------
// Extract question via API
// ---------------------------------------------------------------------------

async function extractQuestion(ctx: AdapterContext, questionId: string): Promise<AdapterExtractResult> {
  const url = `https://www.zhihu.com/question/${questionId}`;
  // Fetch question title from HTML SSR
  const pageResp = await ctx.fetch(url);
  const state = parseInitialState(pageResp.html);
  const questions = (state ? getEntities(state).questions : {}) as Record<string, { title?: string; detail?: string }>;
  const q = Object.values(questions)[0];
  const questionTitle = q?.title || '';
  const questionDetail = strip(q?.detail || '');

  // Fetch answers via API
  const apiUrl = `https://www.zhihu.com/api/v4/questions/${questionId}/answers`
    + `?include=data[*].content,voteup_count,author&limit=10&offset=0`;
  const apiResp = await ctx.fetch(apiUrl, { headers: { Referer: url } });
  const api = JSON.parse(apiResp.html) as {
    data?: Array<{
      content?: string;
      voteup_count?: number;
      author?: { name?: string };
    }>;
  };

  const answers = (api.data || []).map((a) => ({
    author: a.author?.name || '',
    content: strip(a.content || ''),
    voteCount: a.voteup_count || 0,
  }));

  const totalVotes = answers.reduce((s, a) => s + a.voteCount, 0);
  const parts = [
    questionTitle ? `问题：${questionTitle}` : '',
    questionDetail ? `问题说明：${questionDetail}` : '',
    ...answers.map((a, i) =>
      `回答 ${i + 1}${a.author ? ' | 作者：' + a.author : ''} | ${a.voteCount} 赞\n${a.content}`),
  ].filter(Boolean);
  const contentText = truncate(parts.join('\n\n'), 280000);

  return {
    url,
    title: questionTitle || '知乎问题',
    contentText,
    contentState: answers.length > 0 ? (contentText.length >= 1800 ? 'full' : 'partial') : 'failed',
    snippet: truncate(questionDetail || answers[0]?.content || questionTitle, 600),
    evidenceCount: answers.length,
    structuredData: {
      adapter: 'zhihu', pageType: 'question_detail',
      questionTitle, answerCount: answers.length, totalVotes,
      answers: answers.map((a) => ({ author: a.author, voteCount: a.voteCount, length: a.content.length })),
    },
  };
}

// ---------------------------------------------------------------------------
// Extract article via SSR
// ---------------------------------------------------------------------------

async function extractArticle(ctx: AdapterContext, articleId: string): Promise<AdapterExtractResult> {
  const url = `https://zhuanlan.zhihu.com/p/${articleId}`;
  const resp = await ctx.fetch(url);
  const state = parseInitialState(resp.html);
  const articles = (state ? getEntities(state).articles : {}) as Record<string, {
    title?: string;
    content?: string;
    voteupCount?: number;
    author?: { name?: string } | string;
  }>;

  const art = Object.values(articles)[0];
  if (!art) {
    return { url, title: '', contentText: '', contentState: 'failed', snippet: '', evidenceCount: 0 };
  }

  const title = art.title || '';
  const content = strip(art.content || '');
  const voteCount = art.voteupCount || 0;
  const author = typeof art.author === 'object' ? art.author?.name || '' : '';

  const parts = [
    title ? `标题：${title}` : '',
    author ? `作者：${author}` : '',
    voteCount ? `赞同数：${voteCount}` : '',
    content,
  ].filter(Boolean);
  const contentText = truncate(parts.join('\n\n'), 280000);

  return {
    url,
    title,
    contentText,
    contentState: contentText.length >= 1200 ? 'full' : (contentText ? 'partial' : 'failed'),
    snippet: truncate(content || title, 600),
    evidenceCount: content ? 1 : 0,
    structuredData: { adapter: 'zhihu', pageType: 'article_detail', author, voteCount, contentLength: content.length },
  };
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

function parseZhihuUrl(url: string): { type: 'question'; id: string } | { type: 'article'; id: string } | null {
  const questionMatch = url.match(/zhihu\.com\/question\/(\d+)/);
  if (questionMatch) return { type: 'question', id: questionMatch[1] };
  const articleMatch = url.match(/(?:zhuanlan\.zhihu\.com\/p\/|zhihu\.com\/p\/)(\d+)/);
  if (articleMatch) return { type: 'article', id: articleMatch[1] };
  // answer URL → extract question ID from redirect or just return question type
  const answerMatch = url.match(/zhihu\.com\/answer\/(\d+)/);
  if (answerMatch) return { type: 'question', id: answerMatch[1] };
  return null;
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const zhihuAdapter: SiteAdapter = {
  siteKey: 'zhihu',

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async probeLogin(ctx, _site) {
    try {
      // Quick probe: call a lightweight API and check for auth
      const resp = await ctx.fetch('https://www.zhihu.com/api/v4/me', {
        headers: { Referer: 'https://www.zhihu.com/' },
      });
      const data = JSON.parse(resp.html) as { id?: string; error?: { code?: number } };
      if (data.id) {
        return { siteKey: 'zhihu', loginState: 'connected', blockingReason: '', lastError: '' };
      }
      return { siteKey: 'zhihu', loginState: 'expired', blockingReason: '知乎登录已过期', lastError: '' };
    } catch (error) {
      return {
        siteKey: 'zhihu',
        loginState: 'error',
        blockingReason: '无法连接知乎',
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  },

  async search(ctx, query, maxResults) {
    return searchViaApi(ctx, query, maxResults);
  },

  async extract(ctx, url) {
    const parsed = parseZhihuUrl(url);
    if (!parsed) {
      return { url, title: '', contentText: '', contentState: 'failed', snippet: '', evidenceCount: 0 };
    }
    if (parsed.type === 'question') {
      return extractQuestion(ctx, parsed.id);
    }
    return extractArticle(ctx, parsed.id);
  },

  async fetchAccountData(ctx, dataType, options = {}) {
    const limit = Math.min(options.limit ?? 20, 100);
    if (dataType === 'browse_history') {
      return fetchZhihuBrowseHistory(ctx, limit);
    }
    throw new Error(`知乎不支持账号数据类型：${dataType}`);
  },
};
