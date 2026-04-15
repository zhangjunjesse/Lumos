import type {
  AdapterContext,
  AdapterExtractResult,
  AdapterLoginProbe,
  AdapterSearchItem,
  AdapterSearchResult,
  SiteAdapter,
} from '../adapter-types';

const GUTENBERG_BASE = 'https://www.gutenberg.org';

interface GutenbergSearchEntry {
  id: string;
  title: string;
  author: string;
  detailUrl: string;
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

function absolutizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${GUTENBERG_BASE}${url.startsWith('/') ? url : `/${url}`}`;
}

function parseSearchEntries(xml: string, maxResults: number): GutenbergSearchEntry[] {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
  const results: GutenbergSearchEntry[] = [];

  for (const match of entries) {
    const entryXml = match[1] || '';
    const idMatch = entryXml.match(/<id>https?:\/\/www\.gutenberg\.org\/ebooks\/(\d+)\.opds<\/id>/i);
    const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/i);
    const authorMatch = entryXml.match(/<content[^>]*type="text"[^>]*>([\s\S]*?)<\/content>/i);
    const detailMatch = entryXml.match(/<link[^>]+rel="subsection"[^>]+href="([^"]+)"/i);
    if (!idMatch?.[1] || !titleMatch?.[1] || !detailMatch?.[1]) {
      continue;
    }

    results.push({
      id: idMatch[1],
      title: stripTags(titleMatch[1]),
      author: authorMatch?.[1] ? stripTags(authorMatch[1]) : '',
      detailUrl: absolutizeUrl(detailMatch[1]),
    });

    if (results.length >= maxResults) {
      break;
    }
  }

  return results;
}

async function searchCatalog(
  ctx: AdapterContext,
  query: string,
  maxResults: number,
): Promise<AdapterSearchResult> {
  const limit = Math.min(Math.max(maxResults, 1), 20);
  const sourceUrl = `${GUTENBERG_BASE}/ebooks/search.opds/?query=${encodeURIComponent(query)}`;
  const resp = await ctx.fetch(sourceUrl, {
    headers: {
      Accept: 'application/atom+xml,text/xml;q=0.9,*/*;q=0.8',
    },
  });
  const entries = parseSearchEntries(resp.html, limit);
  const items: AdapterSearchItem[] = entries.map((entry) => ({
    url: `${GUTENBERG_BASE}/ebooks/${entry.id}`,
    title: entry.title,
    snippet: truncate(entry.author ? `Author: ${entry.author}` : 'Project Gutenberg eBook', 300),
    extra: {
      ebookId: entry.id,
      author: entry.author || null,
      detailOpdsUrl: entry.detailUrl,
    },
  }));

  return {
    items,
    sourceUrl,
    structuredData: {
      adapter: 'project_gutenberg',
      pageType: 'opds_search',
      resultCount: items.length,
      query,
    },
  };
}

function parseEbookIdFromUrl(url: string): string | null {
  const match = url.match(/\/ebooks\/(\d+)(?:\.opds)?(?:$|[/?#])/i);
  if (match?.[1]) {
    return match[1];
  }
  return null;
}

function buildPlainTextCandidates(ebookId: string): string[] {
  return [
    `${GUTENBERG_BASE}/cache/epub/${ebookId}/pg${ebookId}.txt`,
    `${GUTENBERG_BASE}/cache/epub/${ebookId}/pg${ebookId}.txt.utf8`,
    `${GUTENBERG_BASE}/files/${ebookId}/${ebookId}-0.txt`,
    `${GUTENBERG_BASE}/files/${ebookId}/${ebookId}.txt`,
  ];
}

async function fetchFirstPlainText(ctx: AdapterContext, ebookId: string): Promise<{ url: string; text: string }> {
  const candidates = buildPlainTextCandidates(ebookId);
  let lastError = 'GUTENBERG_TEXT_DOWNLOAD_FAILED';

  for (const candidate of candidates) {
    try {
      const resp = await ctx.fetch(candidate, {
        headers: {
          Accept: 'text/plain,*/*;q=0.8',
        },
      });
      const contentType = resp.contentType || '';
      const text = resp.html || '';
      const looksText = /text\/plain/i.test(contentType) || !contentType;
      const looksValid = text.length > 500 && /Project Gutenberg/i.test(text);
      if (resp.status === 200 && looksText && looksValid) {
        return { url: candidate, text };
      }
      lastError = `GUTENBERG_CANDIDATE_REJECTED:${candidate}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

function extractHeaderValue(text: string, label: string): string {
  const regex = new RegExp(`^${label}:\\s*(.+)$`, 'mi');
  return text.match(regex)?.[1]?.trim() || '';
}

async function extractFullText(ctx: AdapterContext, url: string): Promise<AdapterExtractResult> {
  const ebookId = parseEbookIdFromUrl(url);
  if (!ebookId) {
    return {
      url,
      title: '',
      contentText: '',
      contentState: 'failed',
      snippet: '',
      evidenceCount: 0,
      structuredData: {
        adapter: 'project_gutenberg',
        pageType: 'detail',
        error: 'UNSUPPORTED_URL',
      },
    };
  }

  const { url: downloadUrl, text } = await fetchFirstPlainText(ctx, ebookId);
  const normalized = normalizeWhitespace(text);
  const title = extractHeaderValue(normalized, 'Title') || `Project Gutenberg #${ebookId}`;
  const author = extractHeaderValue(normalized, 'Author');
  const contentText = truncate(normalized, 280000);

  return {
    url: `${GUTENBERG_BASE}/ebooks/${ebookId}`,
    title,
    contentText,
    contentState: normalized.length >= 2000 ? 'full' : (normalized ? 'partial' : 'failed'),
    snippet: truncate(normalized.slice(0, 800), 600),
    evidenceCount: 1,
    structuredData: {
      adapter: 'project_gutenberg',
      pageType: 'plain_text_detail',
      ebookId,
      author: author || null,
      downloadUrl,
      contentLength: normalized.length,
    },
  };
}

async function probeLogin(): Promise<AdapterLoginProbe> {
  return {
    siteKey: 'project_gutenberg',
    loginState: 'connected',
    blockingReason: '',
    lastError: '',
  };
}

export const projectGutenbergAdapter: SiteAdapter = {
  siteKey: 'project_gutenberg',

  async probeLogin(ctx, site) {
    void ctx;
    void site;
    return probeLogin();
  },

  async search(ctx, query, maxResults) {
    return searchCatalog(ctx, query, maxResults);
  },

  async extract(ctx, url) {
    return extractFullText(ctx, url);
  },
};
