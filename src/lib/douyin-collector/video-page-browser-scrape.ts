/**
 * Per-video metadata fallback via Lumos's embedded BrowserManager.
 *
 * Why this exists: anonymous fetch to /share/video/<id> is reliably blocked
 * by douyin's anti-bot — even with logged-in cookies in a same-origin page
 * context, the share endpoint returns a 6KB "验证码中间页" stub with no
 * RENDER_DATA, no og:title, no playAddr. The fetch path therefore can NOT
 * recover metadata for these aweme_ids.
 *
 * navigating a real browser tab to /video/<aweme_id> bypasses this: the SPA
 * renders the full detail page (1MB+ HTML), exposes the real title via
 * <title>, video play_addr via the <video> tag's currentSrc + nested
 * <source> elements, and publish-time / author through data-e2e markers.
 *
 * Contract:
 *   - This is the LAST-RESORT fallback in video-metadata-resilient. It is
 *     slow (5-10s per video, requires a real tab) and may trigger anti-bot
 *     captchas on the user-visible AdsPower tab. Callers must NOT use it
 *     for bulk discovery — only for honest retry of videos that the
 *     anonymous fetch path returned with phase='risk'.
 *   - Returns ScrapedVideoMetadata directly so upsertVideoFromScrape in
 *     jobs.ts can persist the recovered fields. nativeSubtitleUrls extracted
 *     when present in the hydration script; falls back to [] (ASR will
 *     handle).
 */

import {
  resolveBrowserBridgeRuntimeConfig,
  postToBrowserBridge,
  type BrowserBridgeResponse,
} from '@/lib/browser-runtime/bridge-client';
import { normalizeBrowserContextId } from '@/lib/browser-provider/labels';
import {
  injectDouyinCookies,
  resolveDouyinBrowserContextIds,
  DOUYIN_SITE_EVALUATE_TIMEOUT_MS as DOUYIN_EVAL_TIMEOUT,
} from './creator-browser-scrape';
import type { ScrapedVideoMetadata } from './scraper';

// inlined: AdsPower / external-cdp 需要可见 foreground tab, embedded 用 background
function shouldUseForeground(browserContextId: string): boolean {
  return /^(adspower|external-cdp):/i.test(normalizeBrowserContextId(browserContextId));
}
const SITE_EVAL_TIMEOUT_MS = DOUYIN_EVAL_TIMEOUT;
const PAGE_CLOSE_TIMEOUT_MS = 10_000;

// 节流: navigate 是抖音 anti-bot 高敏感行为。串行 + 拉间隔 + 滚动窗口限频,
// 把 retry 84 条压低验证码触发概率。如果窗口内已 5 次 navigate, 直接 reject
// 让 caller 知道"等下个窗口/分批"。
const NAVIGATE_MIN_GAP_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;
const NAVIGATE_RATE_WINDOW_MS = process.env.NODE_ENV === 'test' ? 0 : 60_000;
const NAVIGATE_RATE_MAX = 5;
let navigatePacerChain: Promise<void> = Promise.resolve();
const navigateRecentTimestamps: number[] = [];

type AcquireResult =
  | { ok: true; release: () => void }
  | { ok: false; reason: string };

async function acquireNavigateSlot(): Promise<AcquireResult> {
  // 滚动窗口检查: 60s 内已有 5 次 navigate, 不让再发
  const now = Date.now();
  while (navigateRecentTimestamps.length && now - navigateRecentTimestamps[0] > NAVIGATE_RATE_WINDOW_MS) {
    navigateRecentTimestamps.shift();
  }
  if (navigateRecentTimestamps.length >= NAVIGATE_RATE_MAX) {
    const oldest = navigateRecentTimestamps[0];
    const waitSec = Math.ceil((NAVIGATE_RATE_WINDOW_MS - (now - oldest)) / 1000);
    return {
      ok: false,
      reason: `本批 navigate 兜底已用满（${NAVIGATE_RATE_MAX} / ${Math.round(NAVIGATE_RATE_WINDOW_MS / 1000)}s 窗口）。请 ${waitSec}s 后再点重试,或换批小一些。`,
    };
  }
  // FIFO 串行: 等上一个 navigate 完整结束, 然后 30s 间隔再放下一个
  const prev = navigatePacerChain;
  let chainRelease!: () => void;
  navigatePacerChain = new Promise<void>((resolve) => { chainRelease = resolve; });
  await prev.catch(() => undefined);
  navigateRecentTimestamps.push(Date.now());
  const release = () => {
    // 30s 间隔后才让下一个 navigate acquire 通过
    setTimeout(chainRelease, NAVIGATE_MIN_GAP_MS);
  };
  return { ok: true, release };
}

const VIDEO_DETAIL_SCRAPE_SCRIPT = `
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isChallengePage() {
    var text = ((document.body && document.body.innerText) || '').slice(0, 3000);
    return /验证码|安全验证|captcha|verify|滑块|拖动|验证中间页/i.test((document.title || '') + ' ' + location.href + ' ' + text);
  }
  // detail page hydrates async — give it up to 20s to render <video>+meta
  var waitCycles = 0;
  while (waitCycles < 20) {
    if (isChallengePage()) return { ok: false, error: 'challenge', challenge: true, title: document.title || '' };
    var hasVideo = !!document.querySelector('video');
    var hasDetail = !!document.querySelector('[data-e2e="video-detail"]');
    var hasInfo = !!document.querySelector('[data-e2e="detail-video-info"]');
    if ((hasVideo && hasInfo) || hasDetail) break;
    await sleep(1000);
    waitCycles += 1;
  }

  var rawTitle = document.title || '';
  // strip ' - 抖音' suffix that share pages append
  var title = rawTitle.replace(/\\s*-\\s*抖音\\s*$/, '').trim();
  // duration regex: e.g. "27分钟完整版" → 27 * 60; or  "1分23秒" → 83
  var durationSeconds = 0;
  var m1 = rawTitle.match(/(\\d+)\\s*分钟完整版/);
  var m2 = rawTitle.match(/(\\d+)\\s*分(\\d+)\\s*秒/);
  if (m1) durationSeconds = parseInt(m1[1], 10) * 60;
  else if (m2) durationSeconds = parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10);

  // video element src + sources。但抖音 page 上有多个 <video>/<source>:
  // 真主播放器, 广告预览, 关联推荐... 还有 <source src="player-*.js"> 这种
  // 完全不是 video 的 element。靠 querySelector('video') 拿第一个 + 它的
  // sources 会捞到一堆 player JS、背景图、关联推荐封面之类的垃圾,然后
  // ASR 阶段一个个拒。**白名单过滤**: 只信任抖音真 video CDN 的 URL。
  function looksLikeMp4(u) {
    if (!u || typeof u !== 'string') return false;
    // 真 mp4 CDN 标记 (sample probe: v5-dy-o-abtest.zjcdn.com, v3-dy-o.zjcdn.com,
    // 以及官方 /aweme/v1/play/?file_id= redirector)
    if (/zjcdn\\.com\\/.*\\/video\\//i.test(u)) return true;
    if (/\\/aweme\\/v1\\/play\\//i.test(u)) return true;
    if (/[?&]mime_type=video_mp4/i.test(u)) return true;
    if (/[?&]video_id=/i.test(u) && /douyin\\.com/i.test(u)) return true;
    return false;
  }
  var srcSet = new Set();
  // 优先从主播放器容器内找 video, 退化才用 page 全局 video
  var primaryContainer = document.querySelector('[data-e2e="player-container"]')
    || document.querySelector('[data-e2e="video-detail"]')
    || document;
  var vids = primaryContainer.querySelectorAll('video');
  vids.forEach(function (vid) {
    var cur = vid.currentSrc || vid.src;
    if (looksLikeMp4(cur)) srcSet.add(cur);
    Array.from(vid.querySelectorAll('source')).forEach(function (s) {
      var u = s.src || s.getAttribute('src');
      if (looksLikeMp4(u)) srcSet.add(u);
    });
  });
  var playAddrUrls = Array.from(srcSet);

  // cover from og/lark meta
  var coverEl = document.querySelector('meta[property="lark:url:video_cover_image_url"]');
  var cover = coverEl ? coverEl.getAttribute('content') : null;
  if (!cover) {
    var og = document.querySelector('meta[property="og:image"]');
    if (og) cover = og.getAttribute('content');
  }

  // author from og:description or detail-video-publish-time + author span
  var authorNickname = null;
  var descEl = document.querySelector('meta[name="description"]');
  if (descEl) {
    var desc = descEl.getAttribute('content') || '';
    // pattern: "...- 阿球哥于20250926发布在抖音..." or "...- 阿球哥发布于..."
    var am = desc.match(/[—\\-]\\s*([^\\s—\\-]+?)于\\d{8}发布/);
    if (am) authorNickname = am[1];
  }

  // Try to find native subtitle URLs in any script tag containing
  // "caption_infos" — best-effort, ok to leave [] when no native sub.
  var nativeSubtitleUrls = [];
  try {
    var scripts = document.querySelectorAll('script');
    for (var i = 0; i < scripts.length && nativeSubtitleUrls.length === 0; i++) {
      var t = scripts[i].textContent || '';
      if (t.indexOf('caption_infos') < 0) continue;
      var capMatch = t.match(/"caption_infos"\\s*:\\s*(\\[[\\s\\S]{0,4000}?\\])/);
      if (!capMatch) continue;
      try {
        var caps = JSON.parse(capMatch[1]);
        caps.forEach(function (c) {
          var u = c && (c.url || (c.url_list && c.url_list[0]));
          if (u) nativeSubtitleUrls.push(u);
        });
      } catch (e) {}
    }
  } catch (e) {}

  return {
    ok: true,
    title: title,
    rawTitle: rawTitle,
    durationSeconds: durationSeconds,
    playAddrUrls: playAddrUrls,
    nativeSubtitleUrls: nativeSubtitleUrls,
    cover: cover,
    authorNickname: authorNickname,
    url: location.href,
    isChallenge: false,
  };
})()
`;

export interface BrowserVideoScrapeOutcome {
  ok: boolean;
  metadata?: ScrapedVideoMetadata;
  reason?: string;
  /** true 时调用方知道是 captcha 挡的，可以提示用户而不是无声重试 */
  challenge?: boolean;
}

export async function fetchVideoMetadataViaBrowserPage(
  awemeId: string,
): Promise<BrowserVideoScrapeOutcome> {
  if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') {
    return { ok: false, reason: '测试环境短路。' };
  }
  // 节流: 限频 + 串行 + 30s 间隔。失败时 caller 收到具体原因,不会无脑重试导致雪崩 captcha。
  const slot = await acquireNavigateSlot();
  if (!slot.ok) {
    return { ok: false, reason: slot.reason };
  }
  try {
    const failures: string[] = [];
    for (const browserContextId of resolveDouyinBrowserContextIds()) {
      const outcome = await fetchOnce(awemeId, browserContextId);
      if (outcome.ok) return outcome;
      if (outcome.challenge) return outcome; // 直接抛 challenge 给上层
      if (outcome.reason) failures.push(`${browserContextId}: ${outcome.reason}`);
    }
    return {
      ok: false,
      reason: failures.length > 0 ? failures.join('；') : '所有浏览器上下文都没有拿到视频详情。',
    };
  } finally {
    slot.release();
  }
}

async function fetchOnce(
  awemeId: string,
  browserContextId: string,
): Promise<BrowserVideoScrapeOutcome> {
  const config = resolveBrowserBridgeRuntimeConfig({
    browserContextId,
    lockOwnerId: 'douyin-collector',
  });
  if (!config) {
    return { ok: false, reason: '浏览器 bridge 未就绪。' };
  }
  const cookieInject = await injectDouyinCookies(config);
  if (!cookieInject.ok) {
    return { ok: false, reason: cookieInject.reason ?? '注入 cookie 失败' };
  }

  const navigateTo = `https://www.douyin.com/video/${encodeURIComponent(awemeId)}`;
  interface NewPageResp extends BrowserBridgeResponse { pageId?: string }
  interface EvalResp extends BrowserBridgeResponse {
    value?: unknown;
    url?: string;
    pageId?: string;
  }

  let pageId: string | null = null;
  const useForeground = shouldUseForeground(browserContextId);
  try {
    const page = await postToBrowserBridge<NewPageResp>(
      config,
      '/v1/pages/new',
      { background: !useForeground },
      { timeoutMs: SITE_EVAL_TIMEOUT_MS },
    );
    if (!page.ok || !page.pageId) {
      return { ok: false, reason: `打开新 tab 失败：${page.error ?? 'no pageId'}` };
    }
    pageId = page.pageId;
    await postToBrowserBridge<BrowserBridgeResponse>(
      config,
      '/v1/pages/navigate',
      {
        pageId,
        type: 'url',
        url: navigateTo,
        background: !useForeground,
      },
      { timeoutMs: SITE_EVAL_TIMEOUT_MS },
    );
    const resp = await postToBrowserBridge<EvalResp>(
      config,
      '/v1/pages/evaluate',
      {
        pageId,
        expression: VIDEO_DETAIL_SCRAPE_SCRIPT,
      },
      { timeoutMs: SITE_EVAL_TIMEOUT_MS },
    );
    if (!resp.ok) {
      return { ok: false, reason: `evaluate 失败：${resp.error ?? 'unknown'}` };
    }
    const value = resp.value as
      | {
          ok?: boolean;
          title?: string;
          rawTitle?: string;
          durationSeconds?: number;
          playAddrUrls?: string[];
          nativeSubtitleUrls?: string[];
          cover?: string | null;
          authorNickname?: string | null;
          url?: string;
          challenge?: boolean;
          error?: string;
        }
      | null
      | undefined;
    if (!value) return { ok: false, reason: '脚本未返回结果' };
    if (value.challenge) {
      return {
        ok: false,
        challenge: true,
        reason: `详情页触发验证码（${value.title ?? '验证中间页'}）。请在 AdsPower 浏览器手动过一次再点重试。`,
      };
    }
    if (value.ok === false) {
      return { ok: false, reason: `脚本错误：${value.error ?? 'unknown'}` };
    }
    if (!value.playAddrUrls || value.playAddrUrls.length === 0) {
      // 没拿到 play_addr 即便 title 抓到了也没用（transcribe 不能跑）。
      return {
        ok: false,
        reason: `详情页已渲染但没拿到 play_addr（title="${(value.title ?? '').slice(0, 30)}"）`,
      };
    }
    const metadata: ScrapedVideoMetadata = {
      awemeId,
      title: value.title ?? null,
      cover: value.cover ?? null,
      duration: value.durationSeconds ?? null,
      nativeSubtitleUrls: value.nativeSubtitleUrls ?? [],
      playAddrUrls: value.playAddrUrls,
      authorSecUid: null,
      authorNickname: value.authorNickname ?? null,
    };
    return { ok: true, metadata };
  } catch (err) {
    return {
      ok: false,
      reason: `浏览器详情页抓取异常：${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (pageId) {
      await postToBrowserBridge<BrowserBridgeResponse>(
        config,
        '/v1/pages/close',
        { pageId },
        { timeoutMs: PAGE_CLOSE_TIMEOUT_MS },
      ).catch(() => undefined);
    }
  }
}
