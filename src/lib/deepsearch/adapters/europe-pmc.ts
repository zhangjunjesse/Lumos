import type {
  AdapterContext,
  AdapterExtractResult,
  AdapterLoginProbe,
  AdapterSearchItem,
  AdapterSearchResult,
  SiteAdapter,
} from '../adapter-types';

const EUROPE_PMC_BASE = 'https://europepmc.org';
const EUROPE_PMC_API_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

interface EuropePmcSearchHit {
  id?: string;
  source?: string;
  title?: string;
  abstractText?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  authorString?: string;
  fullTextUrlList?: {
    fullTextUrl?: Array<{ url?: string }>;
  };
}

interface EuropePmcSearchResponse {
  resultList?: {
    result?: EuropePmcSearchHit[];
  };
}

type EuropePmcArticleResponse = EuropePmcSearchHit;

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

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(text: string): string {
  return normalizeWhitespace(decodeXmlEntities(text.replace(/<[^>]+>/g, ' ')));
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function buildSearchUrl(query: string, maxResults: number): string {
  const params = new URLSearchParams({
    query,
    format: 'json',
    pageSize: String(Math.min(Math.max(maxResults, 1), 25)),
    resultType: 'core',
  });
  return `${EUROPE_PMC_API_BASE}/search?${params.toString()}`;
}

function buildArticleUrl(source: string, id: string): string {
  return `${EUROPE_PMC_BASE}/article/${source}/${id}`;
}

function buildArticleApiUrl(source: string, id: string): string {
  const params = new URLSearchParams({
    format: 'json',
    resultType: 'core',
  });
  return `${EUROPE_PMC_API_BASE}/article/${source}/${id}?${params.toString()}`;
}

function buildFullTextXmlUrl(pmcid: string): string {
  return `${EUROPE_PMC_API_BASE}/${pmcid}/fullTextXML`;
}

function parseArticleIdentity(url: string): { source: string; id: string } | null {
  const match = url.match(/\/article\/([^/]+)\/([^/?#]+)/i);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }
  return {
    source: decodeURIComponent(match[1]).toUpperCase(),
    id: decodeURIComponent(match[2]),
  };
}

function parseSearchItems(hits: EuropePmcSearchHit[], maxResults: number): AdapterSearchItem[] {
  return hits
    .filter((hit) => hit.id && hit.source && hit.title)
    .slice(0, maxResults)
    .map((hit) => ({
      url: buildArticleUrl(hit.source!, hit.id!),
      title: normalizeWhitespace(hit.title || ''),
      snippet: truncate(normalizeWhitespace(hit.abstractText || hit.authorString || hit.title || ''), 300),
      extra: {
        source: hit.source || null,
        id: hit.id || null,
        pmid: hit.pmid || null,
        pmcid: hit.pmcid || null,
        doi: hit.doi || null,
        hasFullTextLink: Array.isArray(hit.fullTextUrlList?.fullTextUrl) && hit.fullTextUrlList!.fullTextUrl!.length > 0,
      },
    }));
}

async function searchArticles(
  ctx: AdapterContext,
  query: string,
  maxResults: number,
): Promise<AdapterSearchResult> {
  const sourceUrl = buildSearchUrl(query, maxResults);
  const resp = await ctx.fetch(sourceUrl, {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  const payload = parseJson<EuropePmcSearchResponse>(resp.html);
  const hits = Array.isArray(payload.resultList?.result) ? payload.resultList!.result! : [];
  const items = parseSearchItems(hits, maxResults);

  return {
    items,
    sourceUrl,
    structuredData: {
      adapter: 'europe_pmc',
      pageType: 'search_api',
      resultCount: items.length,
      query,
    },
  };
}

function parseFullTextXml(xml: string): { title: string; bodyText: string } {
  const bodyMatch = xml.match(/<body[\s\S]*?>([\s\S]*?)<\/body>/i);
  const titleMatch = xml.match(/<article-title[^>]*>([\s\S]*?)<\/article-title>/i);
  const bodyText = bodyMatch ? stripTags(bodyMatch[1]) : '';
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  return { title, bodyText };
}

async function fetchArticleMetadata(ctx: AdapterContext, source: string, id: string): Promise<EuropePmcArticleResponse> {
  const url = buildArticleApiUrl(source, id);
  const resp = await ctx.fetch(url, {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  return parseJson<EuropePmcArticleResponse>(resp.html);
}

async function extractArticle(ctx: AdapterContext, url: string): Promise<AdapterExtractResult> {
  const identity = parseArticleIdentity(url);
  if (!identity) {
    return {
      url,
      title: '',
      contentText: '',
      contentState: 'failed',
      snippet: '',
      evidenceCount: 0,
      structuredData: {
        adapter: 'europe_pmc',
        pageType: 'detail',
        error: 'UNSUPPORTED_URL',
      },
    };
  }

  const metadata = await fetchArticleMetadata(ctx, identity.source, identity.id);
  const title = normalizeWhitespace(metadata.title || '');
  const abstractText = normalizeWhitespace(metadata.abstractText || '');
  const pmcid = metadata.pmcid?.trim() || '';

  if (pmcid) {
    try {
      const xmlResp = await ctx.fetch(buildFullTextXmlUrl(pmcid), {
        headers: {
          Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        },
      });
      const parsed = parseFullTextXml(xmlResp.html);
      const content = parsed.bodyText || abstractText;
      if (content) {
        const contentText = truncate(normalizeWhitespace([
          parsed.title || title ? `标题：${parsed.title || title}` : '',
          abstractText ? `摘要：${abstractText}` : '',
          content,
        ].filter(Boolean).join('\n\n')), 280000);
        return {
          url: buildArticleUrl(identity.source, identity.id),
          title: parsed.title || title,
          contentText,
          contentState: content.length >= 1800 ? 'full' : 'partial',
          snippet: truncate(content || abstractText || title, 600),
          evidenceCount: 1,
          structuredData: {
            adapter: 'europe_pmc',
            pageType: 'fulltext_xml',
            source: identity.source,
            id: identity.id,
            pmcid,
            pmid: metadata.pmid || null,
            doi: metadata.doi || null,
            contentLength: content.length,
          },
        };
      }
    } catch {
      // Fall through to abstract-only response.
    }
  }

  const fallbackText = truncate(normalizeWhitespace([
    title ? `标题：${title}` : '',
    abstractText ? `摘要：${abstractText}` : '',
  ].filter(Boolean).join('\n\n')), 280000);

  return {
    url: buildArticleUrl(identity.source, identity.id),
    title,
    contentText: fallbackText,
    contentState: abstractText ? 'partial' : 'failed',
    snippet: truncate(abstractText || title, 600),
    evidenceCount: abstractText ? 1 : 0,
    structuredData: {
      adapter: 'europe_pmc',
      pageType: 'abstract_only',
      source: identity.source,
      id: identity.id,
      pmcid: pmcid || null,
      pmid: metadata.pmid || null,
      doi: metadata.doi || null,
    },
  };
}

async function probeLogin(): Promise<AdapterLoginProbe> {
  return {
    siteKey: 'europe_pmc',
    loginState: 'connected',
    blockingReason: '',
    lastError: '',
  };
}

export const europePmcAdapter: SiteAdapter = {
  siteKey: 'europe_pmc',

  async probeLogin(ctx, site) {
    void ctx;
    void site;
    return probeLogin();
  },

  async search(ctx, query, maxResults) {
    return searchArticles(ctx, query, maxResults);
  },

  async extract(ctx, url) {
    return extractArticle(ctx, url);
  },
};
