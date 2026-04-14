import type {
  SiteAdapter,
  AdapterContext,
  AdapterSearchResult,
  AdapterExtractResult,
  AdapterSearchItem,
  AdapterAccountDataItem,
  AdapterLoginProbe,
} from '../adapter-types';
import {
  SEARCH_SCRAPE_SCRIPT,
  NOTE_SCRAPE_SCRIPT,
  LOGIN_PROBE_SCRIPT,
} from './xhs-dom-scripts';

const XHS_DOMAIN = 'xiaohongshu.com';
const XHS_HOME = 'https://www.xiaohongshu.com/';

interface ScrapedSearchItem {
  noteId: string;
  url: string;
  title: string;
  author: string;
  likeText: string;
  coverUrl: string;
}

interface ScrapedSearchPayload {
  items?: ScrapedSearchItem[];
  count?: number;
  href?: string;
  bodyLen?: number;
}

interface ScrapedNotePayload {
  blocked?: boolean;
  href?: string;
  title?: string;
  desc?: string;
  author?: string;
  likedText?: string;
  collectedText?: string;
  commentText?: string;
  tags?: string[];
  images?: string[];
  ipLocation?: string;
}

function truncate(text: string, max: number): string {
  if (typeof text !== 'string') return '';
  return text.length > max ? text.slice(0, max) : text;
}

function parseCount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return 0;
  const cleaned = v.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const match = /^([\d.]+)\s*(w|万|k|千)?$/i.exec(cleaned);
  if (match) {
    const n = parseFloat(match[1]);
    if (Number.isNaN(n)) return 0;
    const unit = (match[2] || '').toLowerCase();
    if (unit === 'w' || unit === '万') return Math.round(n * 10000);
    if (unit === 'k' || unit === '千') return Math.round(n * 1000);
    return Math.round(n);
  }
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function parseNoteUrl(url: string): { noteId: string; xsecToken: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(?:explore|discovery\/item|search_result)\/([0-9a-f]+)/i);
    if (!m) return null;
    return {
      noteId: m[1],
      xsecToken: u.searchParams.get('xsec_token') || '',
    };
  } catch {
    return null;
  }
}

function buildSearchPageUrl(query: string): string {
  return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_search_result_notes`;
}

async function probeLogin(ctx: AdapterContext): Promise<AdapterLoginProbe> {
  try {
    const { value } = await ctx.siteEvaluate(XHS_DOMAIN, LOGIN_PROBE_SCRIPT, {
      initialUrl: XHS_HOME,
    });
    const payload = value as { loggedIn?: boolean } | null;
    if (payload?.loggedIn) {
      return { siteKey: 'xiaohongshu', loginState: 'connected', blockingReason: '', lastError: '' };
    }
    return {
      siteKey: 'xiaohongshu',
      loginState: 'expired',
      blockingReason: '小红书未登录或登录已过期',
      lastError: '',
    };
  } catch (error) {
    return {
      siteKey: 'xiaohongshu',
      loginState: 'error',
      blockingReason: '无法访问小红书',
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function search(
  ctx: AdapterContext,
  query: string,
  maxResults: number,
): Promise<AdapterSearchResult> {
  const searchUrl = buildSearchPageUrl(query);
  const { value, url } = await ctx.siteEvaluate(XHS_DOMAIN, SEARCH_SCRAPE_SCRIPT, {
    initialUrl: XHS_HOME,
    navigateTo: searchUrl,
  });
  const payload = (value as ScrapedSearchPayload | null) || {};
  const raw = payload.items || [];
  if (raw.length === 0) {
    throw new Error(
      `小红书搜索未抓到卡片。href=${payload.href || url || ''} bodyLen=${payload.bodyLen ?? 0}。可能未登录或页面结构变化。`,
    );
  }

  const items: AdapterSearchItem[] = raw
    .slice(0, maxResults)
    .map((r): AdapterSearchItem => ({
      url: r.url,
      title: truncate(r.title || '', 200),
      snippet: r.author ? `作者：${r.author}` : '',
      voteCount: parseCount(r.likeText),
      extra: { cover: r.coverUrl || '' },
    }));

  return {
    items,
    sourceUrl: searchUrl,
    structuredData: {
      adapter: 'xiaohongshu',
      pageType: 'search',
      resultCount: items.length,
      apiMode: 'dom',
    },
  };
}

async function extract(ctx: AdapterContext, noteUrl: string): Promise<AdapterExtractResult> {
  const parsed = parseNoteUrl(noteUrl);
  if (!parsed) {
    return { url: noteUrl, title: '', contentText: '', contentState: 'failed', snippet: '', evidenceCount: 0 };
  }

  const { value } = await ctx.siteEvaluate(XHS_DOMAIN, NOTE_SCRAPE_SCRIPT, {
    initialUrl: XHS_HOME,
    navigateTo: noteUrl,
  });
  const note = (value as ScrapedNotePayload | null) || {};

  if (note.blocked) {
    return {
      url: noteUrl,
      title: '',
      contentText: '',
      contentState: 'failed',
      snippet: '当前笔记暂时无法浏览',
      evidenceCount: 0,
      structuredData: { adapter: 'xiaohongshu', pageType: 'note_detail', blocked: true },
    };
  }

  const title = note.title || '';
  const desc = note.desc || '';
  const author = note.author || '';
  const tags = note.tags || [];
  const images = note.images || [];

  const parts = [
    title ? `标题：${title}` : '',
    author ? `作者：${author}` : '',
    note.ipLocation ? `IP 属地：${note.ipLocation}` : '',
    note.likedText ? `点赞：${note.likedText}` : '',
    note.collectedText ? `收藏：${note.collectedText}` : '',
    note.commentText ? `评论：${note.commentText}` : '',
    desc,
    tags.length ? `标签：${tags.join(' / ')}` : '',
  ].filter(Boolean);

  return {
    url: noteUrl,
    title: title || '小红书笔记',
    contentText: truncate(parts.join('\n\n'), 200000),
    contentState: desc.length >= 120 ? 'full' : desc ? 'partial' : 'failed',
    snippet: truncate(desc || title, 600),
    evidenceCount: desc ? 1 : 0,
    structuredData: {
      adapter: 'xiaohongshu',
      pageType: 'note_detail',
      noteId: parsed.noteId,
      author,
      likeCount: parseCount(note.likedText),
      tagCount: tags.length,
      imageCount: images.length,
      apiMode: 'dom',
    },
  };
}

async function fetchAccountData(
  _ctx: AdapterContext,
  dataType: string,
): Promise<{ dataType: string; items: AdapterAccountDataItem[]; hasMore: boolean }> {
  throw new Error(`小红书当前 DOM 模式暂不支持账号数据类型：${dataType}`);
}

export const xiaohongshuAdapter: SiteAdapter = {
  siteKey: 'xiaohongshu',
  probeLogin,
  search,
  extract,
  fetchAccountData,
};
