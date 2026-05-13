/**
 * Best-effort scraper for the douyin public share page.
 *
 * Strategy (as of 2026-05):
 *   GET https://www.iesdouyin.com/share/video/<awemeId>/  with **mobile** UA.
 *   - Desktop UA → iesdouyin 302-redirects to www.douyin.com which now
 *     serves a JS-VM-packed payload (no SSR data, anti-bot).
 *   - Mobile UA → iesdouyin serves the share page directly with
 *     `window._ROUTER_DATA = {...}` containing `videoInfoRes.item_list[0]`.
 *
 * Older versions injected SSR via `<script id="RENDER_DATA">` URL-encoded;
 * `extractRenderData` tries _ROUTER_DATA first, falls back to legacy.
 *
 * Honest contract:
 *   - On HTTP error, missing data, or schema drift, we return
 *     `{ ok: false, reason }` with a structured reason, never mock data.
 *   - JSON path is brittle: douyin rotates it. Parsing is isolated in
 *     `extractVideoFromRenderData` so unit tests pin the contract on
 *     known-good fixture HTML.
 *
 * No login / cookie required for public share pages.
 */

const SHARE_URL = (awemeId: string) =>
  `https://www.iesdouyin.com/share/video/${encodeURIComponent(awemeId)}/`;

const SHORT_URL = (token: string) => `https://v.douyin.com/${encodeURIComponent(token)}/`;

const HASHTAG_URL = (tag: string) =>
  `https://www.douyin.com/hashtag/${encodeURIComponent(tag)}`;

const CREATOR_SHARE_URL = (secUid: string) =>
  `https://www.iesdouyin.com/share/user/${encodeURIComponent(secUid)}?from_user_page=1`;

// Desktop UA kept for hashtag pages on www.douyin.com (those still serve
// some SSR content) but iesdouyin share endpoints must use mobile UA.
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/**
 * Resolve a v.douyin.com short link to a canonical douyin URL by following
 * its redirects. Returns the final URL string, or `null` on HTTP error.
 *
 * Honest contract: we don't try to parse anything from the resolved URL
 * here — that's `parseDouyinInput`'s job. We only do the network hop.
 */
export async function resolveShortLink(token: string): Promise<string | null> {
  try {
    const res = await fetch(SHORT_URL(token), {
      headers: { 'user-agent': DESKTOP_UA },
      redirect: 'follow',
    });
    if (!res.ok && res.status !== 302) return null;
    return res.url || null;
  } catch {
    return null;
  }
}

export interface ScrapedVideoMetadata {
  awemeId: string;
  title: string | null;
  cover: string | null;
  duration: number | null;
  authorNickname: string | null;
  authorSecUid: string | null;
  nativeSubtitleUrls: string[];
  /**
   * Best-effort URLs that point to the video's play stream. Only used as a
   * last resort by the local-ASR fallback — the URLs may require referer /
   * cookie headers on download. We capture them so the ASR layer has
   * something to try; if the download fails the failure is reported
   * verbatim, never mocked.
   */
  playAddrUrls: string[];
}

export type ScrapeOutcome =
  | { ok: true; metadata: ScrapedVideoMetadata }
  | { ok: false; reason: string; phase: 'http' | 'parse' | 'extract' };

export async function fetchVideoMetadata(awemeId: string): Promise<ScrapeOutcome> {
  let html: string;
  try {
    const res = await fetch(SHARE_URL(awemeId), {
      headers: {
        // iesdouyin redirects desktop UA to www.douyin.com (JS-VM
        // anti-bot). Mobile UA gets the SSR share page intact.
        'user-agent': MOBILE_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      return {
        ok: false,
        phase: 'http',
        reason: `抖音 share 页返回 HTTP ${res.status}；可能命中风控或视频已删除。`,
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      ok: false,
      phase: 'http',
      reason: `抓取 share 页失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const renderData = extractRenderData(html);
  if (!renderData) {
    return {
      ok: false,
      phase: 'parse',
      reason: 'share 页未找到 RENDER_DATA 注入；douyin 可能已变更 SSR 结构，请等待下一轮迭代。',
    };
  }

  const metadata = extractVideoFromRenderData(renderData, awemeId);
  // Sanity gate: a successful extract returning all-null payload means
  // the SSR matched the awemeId in some stub (e.g., navigation rail)
  // but the actual item_list is empty — typically a deleted / private
  // / region-locked video. Treat as failure so we don't pollute the
  // library with a placeholder row that has no title, cover, or
  // play_addr (and would hard-fail any transcribe attempt).
  const usable =
    metadata &&
    (metadata.title || metadata.authorNickname || metadata.playAddrUrls.length > 0);
  if (!usable) {
    return {
      ok: false,
      phase: 'extract',
      reason: 'RENDER_DATA 中未找到视频元数据；可能是分享被删除或地区受限。',
    };
  }
  return { ok: true, metadata };
}

/**
 * Extract the SSR data blob from an iesdouyin share page.
 *
 * As of 2026-05, iesdouyin's SSR injects data via:
 *   `window._ROUTER_DATA = {"loaderData": {...}};`
 *
 * Older versions used `<script id="RENDER_DATA" type="application/json">`
 * with URL-encoded JSON. We try _ROUTER_DATA first, fall back to the
 * legacy RENDER_DATA. `findAwemeNode` walks the parsed tree generically
 * so the same extraction logic works regardless of structural drift.
 *
 * Exported for unit tests so we can pin the parser on a fixture without
 * making a real HTTP call.
 */
export function extractRenderData(html: string): unknown | null {
  // _ROUTER_DATA path (current iesdouyin SSR shape, mid-2026).
  // Format: `window._ROUTER_DATA = { ...JSON... }</script>` (no trailing
  // semicolon). Regex can't balance braces; do it via a brace counter
  // starting at the `=`'s following `{`. JSON has no unquoted `{`/`}`
  // outside strings, but strings can contain them — we step over string
  // tokens (with escape support) so brace counting stays accurate.
  const anchorIdx = html.indexOf('window._ROUTER_DATA');
  if (anchorIdx >= 0) {
    const start = html.indexOf('{', anchorIdx);
    if (start >= 0) {
      const end = findMatchingBrace(html, start);
      if (end > start) {
        try {
          return JSON.parse(html.slice(start, end + 1));
        } catch {
          /* fall through to legacy */
        }
      }
    }
  }
  // Legacy RENDER_DATA path (kept for older fixtures / future fallback).
  const match = html.match(
    /<script[^>]*id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return JSON.parse(decoded);
  } catch {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

/**
 * Walk a JSON-shaped string starting at `{` and return the index of its
 * matching `}` (or -1 if unbalanced). Handles JSON strings (skipping
 * braces inside quotes, with `\"` escapes). Designed for extracting an
 * outer JSON literal embedded in HTML/JS without bringing in a parser.
 */
function findMatchingBrace(s: string, startIdx: number): number {
  let depth = 0;
  let inString = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') {
        i += 1; // skip escaped char
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface MaybeAweme {
  aweme_id?: string;
  awemeId?: string;
  desc?: string;
  duration?: number;
  video?: {
    cover?: { url_list?: string[]; urlList?: string[] };
    duration?: number;
    play_addr?: { url_list?: string[] };
    caption_infos?: CaptionInfo[];
    caption?: { caption_infos?: CaptionInfo[] };
  };
  author?: {
    nickname?: string;
    sec_uid?: string;
    secUid?: string;
  };
  caption_infos?: CaptionInfo[];
  caption?: { caption_infos?: CaptionInfo[] };
  cover?: { url_list?: string[] };
}

interface CaptionInfo {
  url?: unknown;
  url_list?: unknown;
  urlList?: unknown;
  caption_url?: unknown;
  captionUrl?: unknown;
  subtitle_url?: unknown;
  subtitleUrl?: unknown;
}

export function extractVideoFromRenderData(
  data: unknown,
  awemeId: string,
): ScrapedVideoMetadata | null {
  const aweme = findAwemeNode(data, awemeId);
  if (!aweme) return null;

  const cover =
    pickString(aweme.video?.cover?.url_list) ??
    pickString(aweme.video?.cover?.urlList) ??
    pickString(aweme.cover?.url_list) ??
    null;
  const durationMs =
    typeof aweme.video?.duration === 'number'
      ? aweme.video.duration
      : typeof aweme.duration === 'number'
        ? aweme.duration
        : null;

  const subtitles = collectSubtitleUrls(aweme);

  const playAddrUrls = pickStringList(aweme.video?.play_addr?.url_list);

  return {
    awemeId,
    title: typeof aweme.desc === 'string' && aweme.desc ? aweme.desc : null,
    cover,
    duration: durationMs ? Math.round(durationMs / 1000) : null,
    authorNickname:
      typeof aweme.author?.nickname === 'string' ? aweme.author.nickname : null,
    authorSecUid:
      (typeof aweme.author?.sec_uid === 'string' && aweme.author.sec_uid) ||
      (typeof aweme.author?.secUid === 'string' && aweme.author.secUid) ||
      null,
    nativeSubtitleUrls: subtitles,
    playAddrUrls,
  };
}

function pickStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function collectSubtitleUrls(aweme: MaybeAweme): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  const pushList = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) push(item);
  };
  const collectInfo = (info: CaptionInfo | null | undefined) => {
    if (!info || typeof info !== 'object') return;
    push(info.url);
    push(info.caption_url);
    push(info.captionUrl);
    push(info.subtitle_url);
    push(info.subtitleUrl);
    pushList(info.url_list);
    pushList(info.urlList);
  };
  const collectList = (list: CaptionInfo[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const info of list) collectInfo(info);
  };
  collectList(aweme.caption_infos);
  collectList(aweme.caption?.caption_infos);
  collectList(aweme.video?.caption_infos);
  collectList(aweme.video?.caption?.caption_infos);
  return out;
}

function findAwemeNode(value: unknown, awemeId: string): MaybeAweme | null {
  // Walk the parsed JSON tree for an object whose `aweme_id` (or `awemeId`)
  // matches. Limited depth to avoid runaway in pathological payloads.
  const seen = new WeakSet<object>();
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (depth > 12 || node === null || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    const obj = node as MaybeAweme;
    if (obj.aweme_id === awemeId || obj.awemeId === awemeId) return obj;
    for (const key of Object.keys(node as Record<string, unknown>)) {
      stack.push({ node: (node as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
  return null;
}

function pickString(values: unknown): string | null {
  if (!Array.isArray(values)) return null;
  for (const v of values) {
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

export interface ScrapedCreatorProfile {
  secUid: string;
  nickname: string | null;
  avatar: string | null;
  followerCount: number | null;
  videos: ScrapedVideoMetadata[];
}

export type CreatorScrapeOutcome =
  | { ok: true; profile: ScrapedCreatorProfile }
  | { ok: false; reason: string; phase: 'http' | 'parse' | 'extract' };

export interface ScrapedHashtagResult {
  tag: string;
  videos: ScrapedVideoMetadata[];
}

export type HashtagScrapeOutcome =
  | { ok: true; result: ScrapedHashtagResult }
  | { ok: false; reason: string; phase: 'http' | 'parse' | 'extract' };

/**
 * Scrape `https://www.douyin.com/hashtag/<tag>` for the public list of
 * videos under that hashtag. Reuses the same RENDER_DATA + aweme-list
 * walker as creator scraping — Douyin's SSR puts the initial videos on
 * both pages.
 *
 * Honest contract:
 *   - Only the first SSR batch (typically 10–30 videos) is reachable.
 *     Subsequent pagination requires X-Bogus signing — beyond this
 *     scrape's scope. The route surfaces this as a one-time success.
 *   - Hashtag URL accepts both `#prompt` and `prompt`. Caller passes the
 *     bare tag without the `#`.
 *   - Empty results are treated as a failure with a structured reason
 *     so the user knows why the keyword job ran but nothing showed.
 *
 * Caller can map this onto a `keyword` job kind by treating single-token
 * queries as hashtags.
 */
export async function fetchHashtagVideos(tag: string): Promise<HashtagScrapeOutcome> {
  const cleaned = tag.trim().replace(/^#/, '');
  if (!cleaned) {
    return { ok: false, phase: 'parse', reason: 'hashtag 不能为空。' };
  }
  let html: string;
  try {
    const res = await fetch(HASHTAG_URL(cleaned), {
      headers: {
        'user-agent': DESKTOP_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      return {
        ok: false,
        phase: 'http',
        reason: `hashtag 页返回 HTTP ${res.status}；可能 hashtag 不存在或命中风控。`,
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      ok: false,
      phase: 'http',
      reason: `抓取 hashtag 页失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const renderData = extractRenderData(html);
  if (!renderData) {
    return {
      ok: false,
      phase: 'parse',
      reason: 'hashtag 页未找到 RENDER_DATA；douyin 可能已变更 SSR 结构或要求登录。',
    };
  }
  const videos = extractAwemeList(renderData);
  if (videos.length === 0) {
    return {
      ok: false,
      phase: 'extract',
      reason: 'RENDER_DATA 中未找到视频列表 — 该 hashtag 可能没有公开 SSR 视频，或站点结构已变。',
    };
  }
  return { ok: true, result: { tag: cleaned, videos } };
}

export async function fetchCreatorVideos(secUid: string): Promise<CreatorScrapeOutcome> {
  let html: string;
  try {
    const res = await fetch(CREATOR_SHARE_URL(secUid), {
      headers: {
        // Same anti-bot story as share/video — mobile UA bypasses the
        // desktop redirect to www.douyin.com.
        'user-agent': MOBILE_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      return {
        ok: false,
        phase: 'http',
        reason: `博主主页返回 HTTP ${res.status}；可能账号不存在或命中风控。`,
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      ok: false,
      phase: 'http',
      reason: `抓取博主主页失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Anti-bot signature: as of 2026-05, iesdouyin/share/user/<sec_uid>
  // serves a JS-VM-packed page (`window._$jsvmprt = ...`) instead of
  // SSR. fetch-only path can't decode this; user needs to either paste
  // each video URL manually or wait for BrowserManager-based scraping.
  if (html.includes('_$jsvmprt')) {
    return {
      ok: false,
      phase: 'parse',
      reason:
        '博主主页已被抖音 anti-bot 包成 JS-VM 字节码，纯 fetch 拿不到视频列表。请用「采集任务 → 按链接立即采集」逐条加该博主的视频；后续会通过内置浏览器做有头自动化兜底。',
    };
  }
  const renderData = extractRenderData(html);
  if (!renderData) {
    return {
      ok: false,
      phase: 'parse',
      reason: '博主主页未找到 RENDER_DATA / _ROUTER_DATA；douyin 可能已变更 SSR 结构。请用「按链接立即采集」逐条加视频。',
    };
  }
  const profile = extractCreatorFromRenderData(renderData, secUid);
  if (!profile) {
    return {
      ok: false,
      phase: 'extract',
      reason: 'RENDER_DATA 中未找到博主资料 / 视频列表；可能需要登录或地区受限。请用「按链接立即采集」逐条加视频。',
    };
  }
  return { ok: true, profile };
}

interface MaybeUser {
  sec_uid?: string;
  secUid?: string;
  nickname?: string;
  avatar_thumb?: { url_list?: string[] };
  avatar?: string | { url_list?: string[] };
  follower_count?: number;
  followerCount?: number;
}

export function extractCreatorFromRenderData(
  data: unknown,
  secUid: string,
): ScrapedCreatorProfile | null {
  const user = findUserNode(data, secUid);
  const videos = extractAwemeList(data);
  if (!user && videos.length === 0) return null;

  return {
    secUid,
    nickname:
      typeof user?.nickname === 'string' && user.nickname ? user.nickname : null,
    avatar:
      pickString(user?.avatar_thumb?.url_list) ??
      (typeof user?.avatar === 'string' ? user.avatar : pickString(
        (user?.avatar as { url_list?: string[] } | undefined)?.url_list,
      )) ??
      null,
    followerCount:
      typeof user?.follower_count === 'number'
        ? user.follower_count
        : typeof user?.followerCount === 'number'
          ? user.followerCount
          : null,
    videos,
  };
}

function findUserNode(value: unknown, secUid: string): MaybeUser | null {
  // Both top-level user nodes and aweme.author nodes share `sec_uid`. Prefer
  // nodes that look like a user profile (have follower_count or nickname,
  // and don't have aweme_id) — fall back to any matching node otherwise.
  const seen = new WeakSet<object>();
  const candidates: MaybeUser[] = [];
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (depth > 12 || node === null || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    const obj = node as MaybeUser & { aweme_id?: unknown; awemeId?: unknown };
    if (obj.sec_uid === secUid || obj.secUid === secUid) {
      const isAweme = obj.aweme_id !== undefined || obj.awemeId !== undefined;
      if (!isAweme) candidates.push(obj);
    }
    for (const key of Object.keys(node as Record<string, unknown>)) {
      stack.push({ node: (node as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
  if (candidates.length === 0) return null;
  // Prefer the candidate with follower_count or follower-count-like field set.
  const richer = candidates.find(
    (c) =>
      typeof c.follower_count === 'number' || typeof c.followerCount === 'number',
  );
  return richer ?? candidates[0];
}

function extractAwemeList(value: unknown): ScrapedVideoMetadata[] {
  const found: ScrapedVideoMetadata[] = [];
  const seen = new WeakSet<object>();
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (depth > 12 || node === null || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    const obj = node as Record<string, unknown>;
    // Look for arrays whose items have aweme_id; common keys are
    // aweme_list, post_list, videoList, awemeList, items.
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object' && hasAwemeId(item)) {
            const meta = videoFromAweme(item);
            if (meta && !found.some((existing) => existing.awemeId === meta.awemeId)) {
              found.push(meta);
            }
          }
        }
      } else if (v && typeof v === 'object') {
        stack.push({ node: v, depth: depth + 1 });
      }
    }
  }
  return found;
}

function hasAwemeId(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const obj = node as Record<string, unknown>;
  return typeof obj.aweme_id === 'string' || typeof obj.awemeId === 'string';
}

function videoFromAweme(node: unknown): ScrapedVideoMetadata | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as MaybeAweme;
  const awemeId = obj.aweme_id ?? obj.awemeId;
  if (typeof awemeId !== 'string' || !awemeId) return null;
  const cover =
    pickString(obj.video?.cover?.url_list) ??
    pickString(obj.video?.cover?.urlList) ??
    pickString(obj.cover?.url_list) ??
    null;
  const durationMs =
    typeof obj.video?.duration === 'number'
      ? obj.video.duration
      : typeof obj.duration === 'number'
        ? obj.duration
        : null;
  const subtitles = collectSubtitleUrls(obj);
  const playAddrUrls = pickStringList(obj.video?.play_addr?.url_list);
  return {
    awemeId,
    title: typeof obj.desc === 'string' && obj.desc ? obj.desc : null,
    cover,
    duration: durationMs ? Math.round(durationMs / 1000) : null,
    authorNickname:
      typeof obj.author?.nickname === 'string' ? obj.author.nickname : null,
    authorSecUid:
      (typeof obj.author?.sec_uid === 'string' && obj.author.sec_uid) ||
      (typeof obj.author?.secUid === 'string' && obj.author.secUid) ||
      null,
    nativeSubtitleUrls: subtitles,
    playAddrUrls,
  };
}
