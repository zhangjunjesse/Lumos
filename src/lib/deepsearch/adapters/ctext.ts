import type {
  AdapterContext,
  AdapterExtractResult,
  AdapterLoginProbe,
  AdapterSearchItem,
  AdapterSearchResult,
  SiteAdapter,
} from '../adapter-types';

const CTEXT_BASE = 'https://ctext.org';
const CTEXT_API_BASE = 'https://api.ctext.org';
const MAX_SUBSECTION_FETCHES = 40;

interface CtextReadLinkResponse {
  urn?: string;
  error?: {
    code?: string;
    description?: string;
  };
}

interface CtextGetTextResponse {
  title?: string;
  fulltext?: string[];
  subsections?: string[];
  error?: {
    code?: string;
    description?: string;
  };
}

interface CtextSearchResult {
  url: string;
  title: string;
  snippet: string;
  author?: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return normalizeWhitespace(decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ')));
}

function absolutizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const normalized = url.replace(/^\.?\//, '');
  return `${CTEXT_BASE}/${normalized}`;
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function getApiUrl(endpoint: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return `${CTEXT_API_BASE}/${endpoint}?${search.toString()}`;
}

function buildSearchItems(html: string, maxResults: number): AdapterSearchItem[] {
  const match = html.match(/<ul class="searchres">([\s\S]*?)<\/ul>/i);
  if (!match) {
    return [];
  }

  const blocks = match[1].match(/<li[\s\S]*?<\/li>/gi) ?? [];
  const items: CtextSearchResult[] = [];

  for (const block of blocks) {
    const titleBlockMatch = block.match(/<div class="ctext booksearchresult">([\s\S]*?)<\/div>/i);
    const titleBlock = titleBlockMatch?.[1] || block;
    const anchorMatches = [...titleBlock.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const primary = anchorMatches.at(-1);
    if (!primary) {
      continue;
    }

    const url = absolutizeUrl(decodeHtmlEntities(primary[1]).replace(/&amp;/g, '&'));
    const title = stripTags(primary[2]);
    if (!url || !title) {
      continue;
    }

    const authorMatch = block.match(/<span style="font-weight: bold;">([\s\S]*?)<\/span>/i);
    const author = authorMatch ? stripTags(authorMatch[1]) : '';

    const descriptionBlock = titleBlockMatch ? block.replace(titleBlockMatch[0], ' ') : block;
    const lineParts = descriptionBlock
      .split(/<br\s*\/?>/i)
      .map((part) => stripTags(part))
      .filter(Boolean);
    const descriptiveLines = lineParts.filter((line) => line !== title && line !== author);
    const snippet = truncate([author, ...descriptiveLines].filter(Boolean).join(' | '), 300);

    items.push({
      url,
      title,
      snippet,
      author: author || undefined,
    });

    if (items.length >= maxResults) {
      break;
    }
  }

  return items.map((item) => ({
    url: item.url,
    title: item.title,
    snippet: item.snippet,
    extra: item.author ? { author: item.author } : undefined,
  }));
}

async function searchByTitle(
  ctx: AdapterContext,
  query: string,
  maxResults: number,
): Promise<AdapterSearchResult> {
  const limit = Math.min(Math.max(maxResults, 1), 20);
  const sourceUrl = `${CTEXT_BASE}/searchbooks.pl?if=gb&searchu=${encodeURIComponent(query)}`;
  const resp = await ctx.fetch(sourceUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const items = buildSearchItems(resp.html, limit);
  return {
    items,
    sourceUrl,
    structuredData: {
      adapter: 'ctext',
      pageType: 'title_search',
      resultCount: items.length,
      query,
    },
  };
}

async function resolveUrn(ctx: AdapterContext, url: string): Promise<string> {
  const apiUrl = getApiUrl('readlink', { url });
  const resp = await ctx.fetch(apiUrl, {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  const payload = parseJson<CtextReadLinkResponse>(resp.html);
  if (payload.urn?.trim()) {
    return payload.urn.trim();
  }
  throw new Error(payload.error?.code || payload.error?.description || 'CTEXT_URL_TO_URN_FAILED');
}

async function fetchTextByUrn(ctx: AdapterContext, urn: string): Promise<CtextGetTextResponse> {
  const apiUrl = getApiUrl('gettext', { urn });
  const resp = await ctx.fetch(apiUrl, {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  return parseJson<CtextGetTextResponse>(resp.html);
}

async function collectUrnContent(
  ctx: AdapterContext,
  urn: string,
  visited: Set<string>,
): Promise<{ title: string; content: string; subsectionCount: number; truncated: boolean }> {
  if (visited.has(urn)) {
    return { title: '', content: '', subsectionCount: 0, truncated: false };
  }
  visited.add(urn);

  const payload = await fetchTextByUrn(ctx, urn);
  if (Array.isArray(payload.fulltext) && payload.fulltext.length > 0) {
    return {
      title: payload.title?.trim() || '',
      content: normalizeWhitespace(payload.fulltext.join('\n')),
      subsectionCount: 1,
      truncated: false,
    };
  }

  const subsections = Array.isArray(payload.subsections) ? payload.subsections.filter(Boolean) : [];
  if (subsections.length === 0) {
    throw new Error(payload.error?.code || payload.error?.description || 'CTEXT_EMPTY_TEXT');
  }

  const limited = subsections.slice(0, MAX_SUBSECTION_FETCHES);
  const parts: string[] = [];
  for (const subsectionUrn of limited) {
    const child = await collectUrnContent(ctx, subsectionUrn, visited);
    if (!child.content) {
      continue;
    }
    if (child.title) {
      parts.push(child.title);
    }
    parts.push(child.content);
  }

  return {
    title: payload.title?.trim() || '',
    content: normalizeWhitespace(parts.join('\n\n')),
    subsectionCount: subsections.length,
    truncated: subsections.length > MAX_SUBSECTION_FETCHES,
  };
}

async function fallbackExtractFromHtml(ctx: AdapterContext, url: string): Promise<AdapterExtractResult> {
  const resp = await ctx.fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const titleMatch = resp.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  const content = stripTags(resp.html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' '));
  return {
    url,
    title,
    contentText: truncate(content, 280000),
    contentState: content.length >= 1200 ? 'partial' : (content ? 'partial' : 'failed'),
    snippet: truncate(content || title, 600),
    evidenceCount: content ? 1 : 0,
    structuredData: {
      adapter: 'ctext',
      pageType: 'html_fallback',
      contentLength: content.length,
    },
  };
}

async function extractByUrl(ctx: AdapterContext, url: string): Promise<AdapterExtractResult> {
  try {
    const urn = await resolveUrn(ctx, url);
    const collected = await collectUrnContent(ctx, urn, new Set<string>());
    const contentText = truncate(
      normalizeWhitespace([
        collected.title ? `标题：${collected.title}` : '',
        collected.content,
      ].filter(Boolean).join('\n\n')),
      280000,
    );
    return {
      url,
      title: collected.title,
      contentText,
      contentState: collected.truncated
        ? 'partial'
        : (collected.content.length >= 1200 ? 'full' : (collected.content ? 'partial' : 'failed')),
      snippet: truncate(collected.content || collected.title, 600),
      evidenceCount: Math.max(1, collected.subsectionCount),
      structuredData: {
        adapter: 'ctext',
        pageType: 'text_detail',
        urn,
        subsectionCount: collected.subsectionCount,
        truncatedByLimit: collected.truncated,
        contentLength: collected.content.length,
      },
    };
  } catch {
    return fallbackExtractFromHtml(ctx, url);
  }
}

async function probeLogin(): Promise<AdapterLoginProbe> {
  return {
    siteKey: 'ctext',
    loginState: 'connected',
    blockingReason: '',
    lastError: '',
  };
}

export const ctextAdapter: SiteAdapter = {
  siteKey: 'ctext',

  async probeLogin(ctx, site) {
    void ctx;
    void site;
    return probeLogin();
  },

  async search(ctx, query, maxResults) {
    return searchByTitle(ctx, query, maxResults);
  },

  async extract(ctx, url) {
    return extractByUrl(ctx, url);
  },
};
