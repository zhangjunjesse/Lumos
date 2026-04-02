import type {
  SiteAdapter,
  AdapterContext,
  AdapterSearchResult,
  AdapterExtractResult,
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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ---------------------------------------------------------------------------
// Baidu search for WeChat articles (HTTP via Electron session)
// ---------------------------------------------------------------------------

function parseBaiduResults(html: string): { url: string; title: string; snippet: string }[] {
  const items: { url: string; title: string; snippet: string }[] = [];

  // Split by Baidu result blocks — each starts with `class="result c-container`
  const blocks = html.split(/class="result c-container/);

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const muMatch = block.match(/mu="([^"]*)"/);
    if (!muMatch) continue;
    const mu = decodeHtmlEntities(muMatch[1]);
    if (!mu.includes('mp.weixin.qq.com')) continue;

    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const title = titleMatch ? strip(titleMatch[1]) : '';

    // Try multiple snippet patterns (Baidu changes layout frequently)
    const snippetMatch = block.match(/class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/)
      || block.match(/class="c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/)
      || block.match(/class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/);
    const snippet = snippetMatch ? strip(snippetMatch[1]) : '';

    if (title && mu) {
      items.push({ url: mu, title, snippet: truncate(snippet, 300) });
    }
  }

  return items;
}

async function searchViaBaidu(
  ctx: AdapterContext,
  query: string,
  maxResults: number,
): Promise<AdapterSearchResult> {
  const encoded = encodeURIComponent(`site:mp.weixin.qq.com ${query}`);
  const limit = Math.min(maxResults, 20);
  const rn = Math.min(limit + 5, 50);
  const sourceUrl = `https://www.baidu.com/s?wd=${encoded}&rn=${rn}`;

  const resp = await ctx.fetch(sourceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });

  const items = parseBaiduResults(resp.html).slice(0, limit);

  return {
    items,
    sourceUrl,
    structuredData: { adapter: 'wechat', pageType: 'baidu_search', resultCount: items.length },
  };
}

// ---------------------------------------------------------------------------
// Browser-based content extraction
// WeChat articles require full browser rendering — HTTP always returns an
// empty shell page (ret=-2). Browser capture with Electron session works.
// ---------------------------------------------------------------------------

function buildExtractionScript(): string {
  return `(() => {
    const n = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const title = n(document.querySelector('#activity-name,.rich_media_title')?.innerText || document.title || '');
    const author = n(document.querySelector('#js_name,.profile_nickname')?.innerText || '');
    const publishDate = n(document.querySelector('#publish_time')?.innerText || '');
    const contentEl = document.querySelector('#js_content');
    const content = contentEl ? n(contentEl.innerText || contentEl.textContent || '') : '';
    return { url: location.href, title, author, publishDate, content: content.slice(0, 280000) };
  })()`;
}

async function extractArticle(ctx: AdapterContext, url: string): Promise<AdapterExtractResult> {
  const result = await ctx.browserCapture(url, { script: buildExtractionScript() });
  const payload = result.value as {
    url?: string; title?: string; author?: string; publishDate?: string; content?: string;
  } | null;

  const content = payload?.content || '';
  const title = payload?.title || result.title || '';
  const author = payload?.author || '';
  const publishDate = payload?.publishDate || '';

  const parts = [
    title ? `标题：${title}` : '',
    author ? `公众号：${author}` : '',
    publishDate ? `发布时间：${publishDate}` : '',
    content,
  ].filter(Boolean);
  const contentText = truncate(parts.join('\n\n'), 280000);

  return {
    url: payload?.url || url,
    title,
    contentText,
    contentState: content.length >= 200 ? 'full' : (content ? 'partial' : 'failed'),
    snippet: truncate(content || title, 600),
    evidenceCount: content ? 1 : 0,
    screenshotPath: result.screenshotPath,
    structuredData: {
      adapter: 'wechat', pageType: 'article_detail', fetchMode: 'browser',
      author, publishDate, contentLength: content.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const wechatAdapter: SiteAdapter = {
  siteKey: 'wechat',

  async probeLogin() {
    return { siteKey: 'wechat', loginState: 'connected' as const, blockingReason: '', lastError: '' };
  },

  async search(ctx, query, maxResults) {
    return searchViaBaidu(ctx, query, maxResults);
  },

  async extract(ctx, url) {
    return extractArticle(ctx, url);
  },
};
