import type {
  SiteAdapter,
  AdapterContext,
  AdapterSearchResult,
  AdapterExtractResult,
  AdapterLoginProbe,
} from '../adapter-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

// ---------------------------------------------------------------------------
// Browser extraction scripts
// ---------------------------------------------------------------------------

function buildLinkExtractionScript(): string {
  return `(() => {
    const normalize = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter((a) => {
        const rect = a.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((a) => ({
        url: a.href,
        title: normalize(a.innerText || a.textContent || ''),
      }))
      .filter((l) => l.title.length > 6 && /^https?:/.test(l.url));
    const seen = new Set();
    const unique = [];
    for (const link of links) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      unique.push(link);
      if (unique.length >= 20) break;
    }
    return { url: location.href, title: document.title, links: unique };
  })()`;
}

function buildContentExtractionScript(): string {
  return `(() => {
    const normalize = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const selectors = ['article', 'main', '[role="main"]', '.content', '.post-body', '.entry-content', 'body'];
    let best = '';
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = normalize(el.innerText || el.textContent || '');
      if (text.length > best.length) best = text;
    }
    return {
      url: location.href,
      title: document.title || '',
      content: best.slice(0, 280000),
    };
  })()`;
}

// ---------------------------------------------------------------------------
// Generic Adapter (browser-based fallback)
// ---------------------------------------------------------------------------

export const genericAdapter: SiteAdapter = {
  siteKey: '__generic__',

  async probeLogin(_ctx, _site) {
    // Generic adapter doesn't require login
    return { siteKey: '__generic__', loginState: 'connected' as const, blockingReason: '', lastError: '' };
  },

  async search(ctx, _query, _maxResults): Promise<AdapterSearchResult> {
    // Generic adapter doesn't know how to search — caller should provide the URL directly
    return { items: [], sourceUrl: '', structuredData: { adapter: 'generic', pageType: 'no_search' } };
  },

  async extract(ctx, url): Promise<AdapterExtractResult> {
    // Try HTTP first for SSR content
    try {
      const resp = await ctx.fetch(url);
      if (resp.status === 200 && resp.html.length > 500) {
        const text = extractTextFromHtml(resp.html);
        if (text.length > 200) {
          const title = extractTitleFromHtml(resp.html);
          return {
            url,
            title,
            contentText: truncate(text, 280000),
            contentState: text.length >= 1800 ? 'full' : 'partial',
            snippet: truncate(text, 600),
            evidenceCount: 1,
            structuredData: { adapter: 'generic', fetchMode: 'http', contentLength: text.length },
          };
        }
      }
    } catch {
      // HTTP failed, fall back to browser
    }

    // Fallback: browser capture
    const result = await ctx.browserCapture(url, { script: buildContentExtractionScript() });
    const payload = result.value as { url?: string; title?: string; content?: string } | null;
    const content = payload?.content || '';
    const title = payload?.title || result.title;

    return {
      url: payload?.url || url,
      title,
      contentText: truncate(content, 280000),
      contentState: content.length >= 1800 ? 'full' : (content ? 'partial' : 'failed'),
      snippet: truncate(content, 600),
      evidenceCount: content ? 1 : 0,
      screenshotPath: result.screenshotPath,
      structuredData: { adapter: 'generic', fetchMode: 'browser', contentLength: content.length },
    };
  },
};

// ---------------------------------------------------------------------------
// Simple HTML text extraction (no cheerio dependency)
// ---------------------------------------------------------------------------

function extractTextFromHtml(html: string): string {
  // Remove scripts, styles, nav, footer
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  // Strip tags
  cleaned = strip(cleaned);
  return truncate(cleaned, 280000);
}

function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/);
  return match ? strip(match[1]) : '';
}
