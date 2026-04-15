import type {
  AdapterContext,
  AdapterExtractResult,
  AdapterLoginProbe,
  AdapterSearchItem,
  AdapterSearchResult,
  SiteAdapter,
} from '../adapter-types';

const WIKISOURCE_ZH_BASE = 'https://zh.wikisource.org';
const WIKISOURCE_ZH_API = `${WIKISOURCE_ZH_BASE}/w/api.php`;

interface WikisourceSearchPage {
  pageid?: number;
  index?: number;
  title?: string;
  extract?: string;
  fullurl?: string;
  canonicalurl?: string;
}

interface WikisourceExtractPage {
  pageid?: number;
  title?: string;
  extract?: string;
  fullurl?: string;
  canonicalurl?: string;
  touched?: string;
  length?: number;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function buildApiUrl(params: Record<string, string>): string {
  const search = new URLSearchParams({
    format: 'json',
    formatversion: '2',
    origin: '*',
    ...params,
  });
  return `${WIKISOURCE_ZH_API}?${search.toString()}`;
}

function resolvePageUrl(page: WikisourceSearchPage | WikisourceExtractPage): string {
  if (typeof page.fullurl === 'string' && page.fullurl.trim()) {
    return page.fullurl;
  }
  if (typeof page.canonicalurl === 'string' && page.canonicalurl.trim()) {
    return page.canonicalurl;
  }
  const title = typeof page.title === 'string' ? page.title.trim() : '';
  return title ? `${WIKISOURCE_ZH_BASE}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` : WIKISOURCE_ZH_BASE;
}

function resolveTitleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const titleParam = parsed.searchParams.get('title');
    if (titleParam?.trim()) {
      return decodeURIComponent(titleParam).replace(/_/g, ' ').trim();
    }

    const pathname = parsed.pathname || '/';
    const match = pathname.match(/^\/wiki\/(.+)$/);
    if (!match?.[1]) {
      return null;
    }

    return decodeURIComponent(match[1]).replace(/_/g, ' ').trim();
  } catch {
    return null;
  }
}

function buildSearchItems(pages: WikisourceSearchPage[], maxResults: number): AdapterSearchItem[] {
  return [...pages]
    .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER))
    .map((page) => {
      const title = typeof page.title === 'string' ? page.title.trim() : '';
      const snippet = normalizeWhitespace(page.extract || '');
      return {
        url: resolvePageUrl(page),
        title,
        snippet: truncate(snippet, 300),
        extra: {
          pageId: page.pageid ?? null,
        },
      };
    })
    .filter((item) => item.title && item.url)
    .slice(0, maxResults);
}

async function searchWikisource(
  ctx: AdapterContext,
  query: string,
  maxResults: number,
): Promise<AdapterSearchResult> {
  const limit = Math.min(Math.max(maxResults, 1), 20);
  const sourceUrl = `${WIKISOURCE_ZH_BASE}/wiki/Special:Search?search=${encodeURIComponent(query)}`;
  const apiUrl = buildApiUrl({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(limit),
    gsrnamespace: '0',
    prop: 'info|extracts',
    inprop: 'url',
    exintro: '1',
    explaintext: '1',
    exchars: '300',
    redirects: '1',
  });

  const resp = await ctx.fetch(apiUrl, {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  const payload = parseJson<{ query?: { pages?: WikisourceSearchPage[] } }>(resp.html);
  const pages = Array.isArray(payload.query?.pages) ? payload.query.pages : [];
  const items = buildSearchItems(pages, limit);

  return {
    items,
    sourceUrl,
    structuredData: {
      adapter: 'wikisource_zh',
      pageType: 'search_api',
      resultCount: items.length,
      query,
    },
  };
}

async function extractWikisourcePage(ctx: AdapterContext, url: string): Promise<AdapterExtractResult> {
  const title = resolveTitleFromUrl(url);
  if (!title) {
    return {
      url,
      title: '',
      contentText: '',
      contentState: 'failed',
      snippet: '',
      evidenceCount: 0,
      structuredData: {
        adapter: 'wikisource_zh',
        pageType: 'detail',
        error: 'UNSUPPORTED_URL',
      },
    };
  }

  const apiUrl = buildApiUrl({
    action: 'query',
    prop: 'info|extracts',
    inprop: 'url',
    explaintext: '1',
    redirects: '1',
    titles: title,
  });
  const resp = await ctx.fetch(apiUrl, {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  const payload = parseJson<{ query?: { pages?: WikisourceExtractPage[] } }>(resp.html);
  const page = Array.isArray(payload.query?.pages) ? payload.query?.pages[0] : null;
  const content = normalizeWhitespace(page?.extract || '');
  const resolvedUrl = page ? resolvePageUrl(page) : url;
  const resolvedTitle = typeof page?.title === 'string' ? page.title.trim() : title;
  const contentText = truncate(
    normalizeWhitespace([
      resolvedTitle ? `标题：${resolvedTitle}` : '',
      content,
    ].filter(Boolean).join('\n\n')),
    280000,
  );

  return {
    url: resolvedUrl,
    title: resolvedTitle,
    contentText,
    contentState: content.length >= 1200 ? 'full' : (content ? 'partial' : 'failed'),
    snippet: truncate(content || resolvedTitle, 600),
    evidenceCount: content ? 1 : 0,
    structuredData: {
      adapter: 'wikisource_zh',
      pageType: 'detail',
      pageId: page?.pageid ?? null,
      title: resolvedTitle,
      touched: page?.touched ?? null,
      contentLength: content.length,
    },
  };
}

async function probeLogin(): Promise<AdapterLoginProbe> {
  return {
    siteKey: 'wikisource_zh',
    loginState: 'connected',
    blockingReason: '',
    lastError: '',
  };
}

export const wikisourceZhAdapter: SiteAdapter = {
  siteKey: 'wikisource_zh',

  async probeLogin(ctx, site) {
    void ctx;
    void site;
    return probeLogin();
  },

  async search(ctx, query, maxResults) {
    return searchWikisource(ctx, query, maxResults);
  },

  async extract(ctx, url) {
    return extractWikisourcePage(ctx, url);
  },
};
