import type {
  AdapterContext,
  AdapterExtractResult,
  AdapterLoginProbe,
  AdapterSearchItem,
  AdapterSearchResult,
  SiteAdapter,
} from '../adapter-types';

const EUROPE_PMC_API_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const PMC_ARTICLE_BASE = 'https://pmc.ncbi.nlm.nih.gov/articles';
const PMC_BIOC_BASE = 'https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json';

interface EuropePmcSearchHit {
  id?: string;
  source?: string;
  title?: string;
  abstractText?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  authorString?: string;
}

interface EuropePmcSearchResponse {
  resultList?: {
    result?: EuropePmcSearchHit[];
  };
}

interface BiocPassage {
  text?: string;
}

interface BiocDocument {
  id?: string;
  passages?: BiocPassage[];
}

interface BiocCollection {
  source?: string;
  documents?: BiocDocument[];
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

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function buildSearchUrl(query: string, maxResults: number): string {
  const params = new URLSearchParams({
    query: `${query} OPEN_ACCESS:y IN_PMC:y`,
    format: 'json',
    pageSize: String(Math.min(Math.max(maxResults, 1), 25)),
    resultType: 'core',
  });
  return `${EUROPE_PMC_API_BASE}/search?${params.toString()}`;
}

function buildPmcUrl(pmcid: string): string {
  const normalized = pmcid.startsWith('PMC') ? pmcid : `PMC${pmcid}`;
  return `${PMC_ARTICLE_BASE}/${normalized}/`;
}

function buildBiocUrl(pmcid: string): string {
  const normalized = pmcid.startsWith('PMC') ? pmcid : `PMC${pmcid}`;
  return `${PMC_BIOC_BASE}/${normalized}/unicode`;
}

function parseSearchItems(hits: EuropePmcSearchHit[], maxResults: number): AdapterSearchItem[] {
  return hits
    .filter((hit) => hit.title && hit.pmcid)
    .slice(0, maxResults)
    .map((hit) => ({
      url: buildPmcUrl(hit.pmcid!),
      title: normalizeWhitespace(hit.title || ''),
      snippet: truncate(normalizeWhitespace(hit.abstractText || hit.authorString || hit.title || ''), 300),
      extra: {
        pmcid: hit.pmcid || null,
        pmid: hit.pmid || null,
        doi: hit.doi || null,
        source: hit.source || null,
      },
    }));
}

async function searchOpenAccessPmc(
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
      adapter: 'pmc_bioc',
      pageType: 'search_api',
      resultCount: items.length,
      query,
    },
  };
}

function parsePmcidFromUrl(url: string): string | null {
  const match = url.match(/\/articles\/(PMC\d+)\/?/i);
  return match?.[1] || null;
}

function normalizeBiocPayload(payload: unknown): BiocCollection | null {
  if (Array.isArray(payload)) {
    return (payload[0] as BiocCollection | undefined) ?? null;
  }
  if (payload && typeof payload === 'object') {
    return payload as BiocCollection;
  }
  return null;
}

async function extractBioc(ctx: AdapterContext, url: string): Promise<AdapterExtractResult> {
  const pmcid = parsePmcidFromUrl(url);
  if (!pmcid) {
    return {
      url,
      title: '',
      contentText: '',
      contentState: 'failed',
      snippet: '',
      evidenceCount: 0,
      structuredData: {
        adapter: 'pmc_bioc',
        pageType: 'detail',
        error: 'UNSUPPORTED_URL',
      },
    };
  }

  const resp = await ctx.fetch(buildBiocUrl(pmcid), {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  const payload = normalizeBiocPayload(parseJson<unknown>(resp.html));
  const document = payload?.documents?.[0];
  const passages = Array.isArray(document?.passages) ? document!.passages! : [];
  const texts = passages
    .map((passage) => normalizeWhitespace(passage.text || ''))
    .filter(Boolean);
  const content = normalizeWhitespace(texts.join('\n\n'));
  const title = texts[0]?.slice(0, 200) || document?.id || pmcid;
  const contentText = truncate(content, 280000);

  return {
    url: buildPmcUrl(pmcid),
    title,
    contentText,
    contentState: content.length >= 1800 ? 'full' : (content ? 'partial' : 'failed'),
    snippet: truncate(content || pmcid, 600),
    evidenceCount: texts.length > 0 ? 1 : 0,
    structuredData: {
      adapter: 'pmc_bioc',
      pageType: 'bioc_json',
      pmcid,
      source: payload?.source || null,
      documentId: document?.id || null,
      passageCount: passages.length,
      contentLength: content.length,
    },
  };
}

async function probeLogin(): Promise<AdapterLoginProbe> {
  return {
    siteKey: 'pmc_bioc',
    loginState: 'connected',
    blockingReason: '',
    lastError: '',
  };
}

export const pmcBiocAdapter: SiteAdapter = {
  siteKey: 'pmc_bioc',

  async probeLogin(ctx, site) {
    void ctx;
    void site;
    return probeLogin();
  },

  async search(ctx, query, maxResults) {
    return searchOpenAccessPmc(ctx, query, maxResults);
  },

  async extract(ctx, url) {
    return extractBioc(ctx, url);
  },
};
