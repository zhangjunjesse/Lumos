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
  const renderMetadata = renderData ? extractVideoFromRenderData(renderData, awemeId) : null;
  const htmlMetadata = extractVideoMetadataFromHtml(html, awemeId);
  const metadata = isUsableVideoMetadata(renderMetadata)
    ? mergeVideoMetadata(renderMetadata, htmlMetadata)
    : htmlMetadata;
  // Sanity gate: a successful extract returning all-null payload means
  // the SSR matched the awemeId in some stub (e.g., navigation rail)
  // but the actual item_list is empty — typically a deleted / private
  // / region-locked video. Treat as failure so we don't pollute the
  // library with a placeholder row that has no title, cover, or
  // play_addr (and would hard-fail any transcribe attempt).
  const usable =
    metadata && isUsableVideoMetadata(metadata);
  if (!usable) {
    if (!renderData) {
      return {
        ok: false,
        phase: 'parse',
        reason:
          'share 页未找到 _ROUTER_DATA / RENDER_DATA，也无法从页面标题、描述或封面提取视频信息；抖音可能已变更分享页结构或触发风控。',
      };
    }
    return {
      ok: false,
      phase: 'extract',
      reason:
        'share 页数据中未找到可用视频元数据；可能是分享被删除、地区受限，或抖音页面结构已变。',
    };
  }
  return { ok: true, metadata };
}

function isUsableVideoMetadata(
  metadata: ScrapedVideoMetadata | null | undefined,
): metadata is ScrapedVideoMetadata {
  return Boolean(
    metadata &&
    (metadata.title || metadata.authorNickname || metadata.cover || metadata.playAddrUrls.length > 0),
  );
}

function mergeVideoMetadata(
  primary: ScrapedVideoMetadata,
  fallback: ScrapedVideoMetadata | null,
): ScrapedVideoMetadata {
  if (!fallback) return primary;
  return {
    awemeId: primary.awemeId,
    title: primary.title ?? fallback.title,
    cover: primary.cover ?? fallback.cover,
    duration: primary.duration ?? fallback.duration,
    authorNickname: primary.authorNickname ?? fallback.authorNickname,
    authorSecUid: primary.authorSecUid ?? fallback.authorSecUid,
    nativeSubtitleUrls: uniqueStrings([
      ...primary.nativeSubtitleUrls,
      ...fallback.nativeSubtitleUrls,
    ]),
    playAddrUrls: uniqueStrings([
      ...primary.playAddrUrls,
      ...fallback.playAddrUrls,
    ]),
  };
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
  for (const globalName of [
    'window._ROUTER_DATA',
    'window.__UNIVERSAL_DATA_FOR_REHYDRATION__',
    'window.SIGI_STATE',
    'window.__INITIAL_STATE__',
  ]) {
    const parsed = extractAssignedJson(html, globalName);
    if (parsed) return parsed;
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

function extractAssignedJson(html: string, anchor: string): unknown | null {
  const anchorIdx = html.indexOf(anchor);
  if (anchorIdx < 0) return null;
  const start = html.indexOf('{', anchorIdx);
  if (start < 0) return null;
  const end = findMatchingBrace(html, start);
  if (end <= start) return null;
  try {
    return JSON.parse(html.slice(start, end + 1));
  } catch {
    return null;
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
  aweme_id_str?: string;
  awemeId?: string;
  awemeIdStr?: string;
  item_id?: string;
  itemId?: string;
  group_id_str?: string;
  groupId?: string;
  desc?: string;
  title?: string;
  duration?: number;
  video?: {
    cover?: { url_list?: string[]; urlList?: string[] };
    origin_cover?: { url_list?: string[]; urlList?: string[] };
    dynamic_cover?: { url_list?: string[]; urlList?: string[] };
    duration?: number;
    play_addr?: { url_list?: string[]; urlList?: string[] };
    playAddr?: { url_list?: string[]; urlList?: string[] };
    download_addr?: { url_list?: string[]; urlList?: string[] };
    caption_infos?: CaptionInfo[];
    caption?: { caption_infos?: CaptionInfo[] };
  };
  author?: {
    nickname?: string;
    sec_uid?: string;
    secUid?: string;
  };
  share_info?: {
    share_title?: string;
    shareTitle?: string;
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
    pickString(aweme.video?.origin_cover?.url_list) ??
    pickString(aweme.video?.origin_cover?.urlList) ??
    pickString(aweme.video?.dynamic_cover?.url_list) ??
    pickString(aweme.video?.dynamic_cover?.urlList) ??
    pickString(aweme.cover?.url_list) ??
    null;
  const durationMs =
    typeof aweme.video?.duration === 'number'
      ? aweme.video.duration
      : typeof aweme.duration === 'number'
        ? aweme.duration
        : null;

  const subtitles = collectSubtitleUrls(aweme);

  const playAddrUrls = uniqueStrings([
    ...pickStringList(aweme.video?.play_addr?.url_list),
    ...pickStringList(aweme.video?.play_addr?.urlList),
    ...pickStringList(aweme.video?.playAddr?.url_list),
    ...pickStringList(aweme.video?.playAddr?.urlList),
    ...pickStringList(aweme.video?.download_addr?.url_list),
    ...pickStringList(aweme.video?.download_addr?.urlList),
  ]);

  return {
    awemeId,
    title: pickText(aweme.desc, aweme.title, aweme.share_info?.share_title, aweme.share_info?.shareTitle),
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

export function extractVideoMetadataFromHtml(
  html: string,
  awemeId: string,
): ScrapedVideoMetadata | null {
  const description = getMetaContent(html, 'description') ?? '';
  const titleTag = getTitleText(html) ?? '';
  const title = parseShareTitle(description, titleTag);
  const authorNickname = parseShareAuthor(description);
  const cover =
    getMetaContent(html, 'og:image') ??
    getMetaContent(html, 'twitter:image') ??
    getPosterImage(html) ??
    null;
  const playAddrUrls = extractPlayAddrUrlsFromHtml(html);
  if (!title && !authorNickname && !cover && playAddrUrls.length === 0) return null;
  return {
    awemeId,
    title,
    cover,
    duration: null,
    authorNickname,
    authorSecUid: null,
    nativeSubtitleUrls: [],
    playAddrUrls,
  };
}

function parseShareTitle(description: string, titleTag: string): string | null {
  const desc = decodeHtmlEntities(description).trim();
  const m = /^(.*?)\s*-\s*[^-]{1,100}?于\d{4}/.exec(desc);
  const value = (m?.[1] || titleTag || desc)
    .replace(/\s*-\s*抖音\s*$/, '')
    .trim();
  return value || null;
}

function parseShareAuthor(description: string): string | null {
  const desc = decodeHtmlEntities(description).trim();
  const m = /\s-\s([^-\n]{1,100}?)于\d{4}/.exec(desc);
  const value = m?.[1]?.trim();
  return value || null;
}

function getTitleText(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const value = match?.[1] ? decodeHtmlEntities(match[1]).trim() : '';
  return value || null;
}

function getMetaContent(html: string, name: string): string | null {
  const wanted = name.toLowerCase();
  const matches = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of matches) {
    const attrs = parseAttrs(tag);
    const key = (attrs.name || attrs.property || attrs.itemprop || '').toLowerCase();
    if (key !== wanted) continue;
    const content = attrs.content?.trim();
    if (content) return decodeHtmlEntities(content);
  }
  return null;
}

function getPosterImage(html: string): string | null {
  const matches = html.match(/<img\b[^>]*>/gi) ?? [];
  let fallback: string | null = null;
  for (const tag of matches) {
    const attrs = parseAttrs(tag);
    const src = decodeHtmlEntities(attrs.src || attrs['data-src'] || '').trim();
    if (!src) continue;
    if (!fallback && /douyinpic|byteimg|bytedance/i.test(src)) fallback = src;
    if (/\bposter\b/i.test(attrs.class || '')) return src;
  }
  return fallback;
}

function extractPlayAddrUrlsFromHtml(html: string): string[] {
  const normalized = normalizeEmbeddedText(html);
  const urls = normalized.match(/https?:\/\/[^"'<>\s]+/g) ?? [];
  return uniqueStrings(urls
    .map((url) => decodeHtmlEntities(url).replace(/\\\//g, '/'))
    .filter((url) => /(?:aweme|douyin|snssdk).*\/(?:aweme\/v1\/play|playwm|play)/i.test(url)));
}

function normalizeEmbeddedText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/%2F/gi, '/')
    .replace(/%3A/gi, ':')
    .replace(/%3F/gi, '?')
    .replace(/%3D/gi, '=')
    .replace(/%26/gi, '&');
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = decodeHtmlEntities(m[3]);
  }
  return attrs;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function pickText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function pickStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
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
    if (getAwemeId(obj) === awemeId) return obj;
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
  return Boolean(getAwemeId(obj as MaybeAweme));
}

function videoFromAweme(node: unknown): ScrapedVideoMetadata | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as MaybeAweme;
  const awemeId = getAwemeId(obj);
  if (typeof awemeId !== 'string' || !awemeId) return null;
  const cover =
    pickString(obj.video?.cover?.url_list) ??
    pickString(obj.video?.cover?.urlList) ??
    pickString(obj.video?.origin_cover?.url_list) ??
    pickString(obj.video?.origin_cover?.urlList) ??
    pickString(obj.video?.dynamic_cover?.url_list) ??
    pickString(obj.video?.dynamic_cover?.urlList) ??
    pickString(obj.cover?.url_list) ??
    null;
  const durationMs =
    typeof obj.video?.duration === 'number'
      ? obj.video.duration
      : typeof obj.duration === 'number'
        ? obj.duration
        : null;
  const subtitles = collectSubtitleUrls(obj);
  const playAddrUrls = uniqueStrings([
    ...pickStringList(obj.video?.play_addr?.url_list),
    ...pickStringList(obj.video?.play_addr?.urlList),
    ...pickStringList(obj.video?.playAddr?.url_list),
    ...pickStringList(obj.video?.playAddr?.urlList),
    ...pickStringList(obj.video?.download_addr?.url_list),
    ...pickStringList(obj.video?.download_addr?.urlList),
  ]);
  return {
    awemeId,
    title: pickText(obj.desc, obj.title, obj.share_info?.share_title, obj.share_info?.shareTitle),
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

function getAwemeId(obj: MaybeAweme): string | null {
  return pickText(
    obj.aweme_id,
    obj.aweme_id_str,
    obj.awemeId,
    obj.awemeIdStr,
    obj.item_id,
    obj.itemId,
    obj.group_id_str,
    obj.groupId,
  );
}
