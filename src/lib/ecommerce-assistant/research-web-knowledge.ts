/**
 * 主题知识检索（调研专用，走内置浏览器 bridge，绝不抓 marketplace 商品页）。
 *
 * 「调研」= 选题/知识研究：query 是研究主题而非某平台商品关键词。这里取
 * DuckDuckGo no-JS HTML 端点的 SERP，解析自然结果（标题/链接/摘要）作为
 * 真实数据。
 *
 * 根因订正：原实现用**服务端裸 fetch** 直怼 DDG，被结构性 403/anomaly 拦截
 * → 调研永远零数据、模块完全不可用。改走 `fetchViaBrowser`（与 discover/选品
 * 同一条已验证路径：真实浏览器指纹 + 用户住宅 IP + 后台模式，不抢前台 UI），
 * DDG 不再当机器人拦。浏览器运行时未连接 / 未启用时**如实**返回 warning
 * （调用方转 notice，绝不伪造，对齐调研「零数据写明原因」红线）。
 *
 * 仍**不**抓 etsy/amazon 商品页（那是 discover/选品 职责）——这里只取 SERP，
 * platform 仅作研究上下文词。
 */
import { fetchViaBrowser, BrowserFetchError } from './browser-fetcher';
import type { BrowserFetchSettings } from './discover-settings';

const DDG_HTML = 'https://html.duckduckgo.com/html/';

export interface TopicKnowledgeItem {
  title: string;
  url: string;
  snippet?: string;
}

export interface TopicKnowledgeResult {
  /** 实际提交的检索词（含 platform 上下文，报告可追溯）。 */
  searchQuery: string;
  items: TopicKnowledgeItem[];
  /** 非空=未拿到可用数据；调用方据此转 notice，不计真实数据。 */
  warning?: string;
}

export interface TopicKnowledgeOpts {
  query: string;
  /** 平台仅作研究上下文（如 "etsy 选品"），不会被拼成商品搜索 URL。 */
  platform?: string | null;
  signal?: AbortSignal;
  maxResults?: number;
  /** 内置浏览器抓取设置；缺省或未启用时如实返回 warning（不裸 fetch）。 */
  browserSettings?: BrowserFetchSettings;
}

/** platform 仅当是有意义的上下文词时并入检索（"general"/空 视为无上下文）。 */
function buildSearchQuery(query: string, platform?: string | null): string {
  const topic = query.trim();
  const ctx = (platform ?? '').trim().toLowerCase();
  if (!ctx || ctx === 'general' || topic.toLowerCase().includes(ctx)) return topic;
  return `${topic} ${ctx}`;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

/** DDG 用 /l/?uddg=<encoded> 跳转包装真实 URL；解出之。 */
function resolveDdgUrl(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through */
    }
  }
  return href.startsWith('//') ? `https:${href}` : href;
}

/** DDG 反爬/anomaly 拦截页特征（非结果页）。 */
function isAnomalyPage(html: string): boolean {
  return /anomaly-modal__|class="anomaly|If this error persists/i.test(html);
}

/**
 * 解析 DDG HTML 端点 SERP。该端点结构长期稳定：每条结果
 * `<a class="result__a" href=...>标题</a>` + `<a class="result__snippet">摘要</a>`。
 * 容错：标题缺失/非 http 链接跳过。
 */
function parseDdgHtml(html: string, max: number): TopicKnowledgeItem[] {
  const items: TopicKnowledgeItem[] = [];
  const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets: string[] = [];
  let s: RegExpExecArray | null;
  while ((s = snippetRe.exec(html)) !== null) snippets.push(stripTags(s[1]));
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = titleRe.exec(html)) !== null && items.length < max) {
    const url = resolveDdgUrl(m[1]);
    const title = stripTags(m[2]);
    if (title && /^https?:\/\//i.test(url)) {
      items.push({
        title: title.slice(0, 240),
        url,
        snippet: snippets[idx]?.slice(0, 280) || undefined,
      });
    }
    idx += 1;
  }
  return items;
}

/** 主题知识检索。永不抛：失败返回 `{ items: [], warning }`，调用方如实呈现。 */
export async function fetchTopicKnowledge(
  opts: TopicKnowledgeOpts,
): Promise<TopicKnowledgeResult> {
  const searchQuery = buildSearchQuery(opts.query, opts.platform);
  const max = Math.min(Math.max(opts.maxResults ?? 12, 1), 20);
  if (!searchQuery) {
    return { searchQuery, items: [], warning: 'query 为空，无法检索。' };
  }
  if (!opts.browserSettings?.enabled) {
    return {
      searchQuery,
      items: [],
      warning:
        '「设置 → 浏览器」未启用内置浏览器抓取，调研无法获取公开网络数据——启用后重试。',
    };
  }
  // GET 形式（?q=）便于浏览器导航；走 fetchViaBrowser=真实指纹+后台模式，
  // 不再被 DDG 当服务端机器人 403。
  const url = `${DDG_HTML}?q=${encodeURIComponent(searchQuery)}`;
  let html: string;
  try {
    const out = await fetchViaBrowser(url, opts.browserSettings, {
      timeoutMs: 60_000,
      abortSignal: opts.signal,
    });
    html = out.html;
  } catch (err) {
    const reason =
      err instanceof BrowserFetchError || err instanceof Error
        ? err.message
        : String(err);
    return {
      searchQuery,
      items: [],
      warning: `主题检索经内置浏览器失败：${reason}（确认 Lumos 桌面端浏览器运行时已启动）`,
    };
  }
  if (isAnomalyPage(html)) {
    return {
      searchQuery,
      items: [],
      warning: '主题检索被 DuckDuckGo 反爬拦截（换检索词或稍后重试）',
    };
  }
  const items = parseDdgHtml(html, max);
  if (items.length === 0) {
    return {
      searchQuery,
      items: [],
      warning: '主题检索返回 0 条自然结果（该主题或无公开资料）',
    };
  }
  return { searchQuery, items };
}
