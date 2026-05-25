/**
 * Resilient per-video metadata back-fill for the keyword / creator paths.
 *
 * Problem (see jobs.ts): the discovery layer (browser + cookie) yields a
 * batch of aweme_ids; the back-fill layer then fetched each one's
 * iesdouyin share page over **anonymous HTTP**. Dozens of anonymous
 * requests bursting from one IP get rate-limited — douyin answers 200
 * with a generic SEO skeleton (no _ROUTER_DATA). Most ids came back as
 * junk; a lucky few got real data.
 *
 * This module fixes the real cause with two layers:
 *   1. A process-wide pacer serialises + spaces the anonymous fetches so
 *      a 30-id batch no longer bursts.
 *   2. When the anonymous fetch still returns `phase:'risk'` (the honest
 *      skeleton signal added in scraper.ts), retry that single id through
 *      the user's logged-in browser context — the same one that
 *      discovered the ids — reading the real video page's window state.
 *
 * Honest contract: a genuinely deleted / private video (`phase:'extract'`
 * / `'parse'` / `'http'`) is NOT retried via browser — it's gone, the
 * browser can't conjure it. Only `'risk'` (rate-limit skeleton) is.
 */

import {
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
  type BrowserBridgeResponse,
} from '@/lib/browser-runtime/bridge-client';
import {
  closeDouyinScrapePage,
  describeDouyinChallengePage,
  DOUYIN_DOMAIN,
  DOUYIN_SITE_EVALUATE_TIMEOUT_MS,
  focusDouyinScrapePage,
  injectDouyinCookies,
  resolveDouyinBrowserContextIds,
} from './creator-browser-scrape';
import {
  extractRenderData,
  extractVideoFromRenderData,
  extractVideoMetadataFromHtml,
  fetchVideoMetadata,
  isRiskControlSkeleton,
  isUsableVideoMetadata,
  mergeVideoMetadata,
  type ScrapeOutcome,
  type ScrapedVideoMetadata,
} from './scraper';
import { fetchVideoMetadataViaBrowserPage } from './video-page-browser-scrape';

const IS_TEST = Boolean(process.env.JEST_WORKER_ID) || process.env.NODE_ENV === 'test';

// Spacing between successive anonymous share-page fetches. ~1.1s + up to
// 0.7s jitter empirically keeps a 30-id keyword batch under douyin's
// burst threshold. Zeroed under jest so suites don't sleep.
const MIN_GAP_MS = IS_TEST ? 0 : 1100;
const JITTER_MS = IS_TEST ? 0 : 700;

// Single FIFO chain: each paced() call waits for the previous to finish,
// then a randomised gap elapses before the next is allowed to start.
let pacerChain: Promise<void> = Promise.resolve();

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const prev = pacerChain;
  let release!: () => void;
  pacerChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    setTimeout(release, MIN_GAP_MS + Math.floor(Math.random() * (JITTER_MS + 1)));
  }
}

/**
 * DOM script: douyin's real desktop video page hydrates its data into one
 * of several window globals. Return the first present one stringified,
 * plus a bounded HTML snapshot as a fallback, plus a challenge flag.
 */
const VIDEO_PAGE_SCRIPT = `
(async function () {
  try {
    function pick() {
      var keys = ['_ROUTER_DATA', '__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE', '__INITIAL_STATE__', 'RENDER_DATA'];
      for (var i = 0; i < keys.length; i++) {
        try { if (window[keys[i]]) return window[keys[i]]; } catch (_) {}
      }
      return null;
    }
    function safeStringify(value) {
      var seen = [];
      try {
        return JSON.stringify(value, function (k, v) {
          if (typeof v === 'function') return undefined;
          if (!v || typeof v !== 'object') return v;
          if (seen.indexOf(v) >= 0) return undefined;
          if (seen.length > 5000) return undefined;
          seen.push(v);
          return v;
        });
      } catch (_) { return ''; }
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function isChallenge() {
      var t = ((document.body && document.body.innerText) || '').slice(0, 3000);
      return /验证码|安全验证|captcha|verify|滑块|拖动|验证中间页/i.test((document.title || '') + ' ' + location.href + ' ' + t);
    }
    var state = pick();
    for (var attempt = 0; attempt < 5 && !state; attempt++) {
      await sleep(2000);
      state = pick();
    }
    var html = document.documentElement ? document.documentElement.outerHTML : '';
    return {
      ok: true,
      title: document.title || '',
      challenge: isChallenge(),
      state: state ? safeStringify(state) : '',
      html: html.slice(0, 900000),
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
})()
`;

interface VideoPageEvalValue {
  ok?: boolean;
  title?: string;
  challenge?: boolean;
  state?: string;
  html?: string;
  error?: string;
}

function parseBrowserPayload(
  value: VideoPageEvalValue,
  awemeId: string,
): ScrapeOutcome {
  let renderData: unknown = null;
  if (value.state) {
    try {
      renderData = JSON.parse(value.state);
    } catch {
      renderData = null;
    }
  }
  let hadRender = Boolean(renderData);
  let meta: ScrapedVideoMetadata | null = renderData
    ? extractVideoFromRenderData(renderData, awemeId)
    : null;

  if (!isUsableVideoMetadata(meta) && value.html) {
    const fromHtml = extractRenderData(value.html);
    if (fromHtml) {
      hadRender = true;
      meta = extractVideoFromRenderData(fromHtml, awemeId);
    }
    const htmlMeta = extractVideoMetadataFromHtml(value.html, awemeId);
    meta = isUsableVideoMetadata(meta) ? mergeVideoMetadata(meta, htmlMeta) : htmlMeta;
  }

  if (isRiskControlSkeleton(meta, hadRender)) {
    return {
      ok: false,
      phase: 'risk',
      reason: '登录浏览器打开视频页仍是风控骨架页（无 _ROUTER_DATA / 作者 / 封面 / play_addr）。',
    };
  }
  if (!isUsableVideoMetadata(meta)) {
    return {
      ok: false,
      phase: 'extract',
      reason: '登录浏览器页面未解析出可用视频元数据；可能视频已删除或地区受限。',
    };
  }
  return { ok: true, metadata: meta };
}

/**
 * Fetch one video's metadata through the user's selected logged-in
 * browser context (the same one that discovered the id). Used only as a
 * fallback when anonymous HTTP hit the rate-limit skeleton.
 */
export async function fetchVideoMetadataViaBrowser(
  awemeId: string,
): Promise<ScrapeOutcome> {
  if (IS_TEST) {
    return { ok: false, phase: 'risk', reason: '测试环境短路（不连 bridge）。' };
  }
  const failures: string[] = [];
  for (const browserContextId of resolveDouyinBrowserContextIds()) {
    const config = resolveBrowserBridgeRuntimeConfig({
      browserContextId,
      lockOwnerId: 'douyin-collector',
    });
    if (!config) {
      failures.push(`${browserContextId}: 浏览器 bridge 未就绪（仅 Electron 启动后可用）。`);
      continue;
    }
    const cookieInject = await injectDouyinCookies(config);
    if (!cookieInject.ok) {
      failures.push(`${browserContextId}: ${cookieInject.reason ?? '注入 cookie 失败'}`);
      continue;
    }
    interface EvalResp extends BrowserBridgeResponse {
      value?: VideoPageEvalValue;
      pageId?: string;
    }
    let resp: EvalResp | null = null;
    let keepPageOpen = false;
    try {
      resp = await postToBrowserBridge<EvalResp>(
        config,
        '/v1/site-pages/evaluate',
        {
          domain: DOUYIN_DOMAIN,
          script: VIDEO_PAGE_SCRIPT,
          initialUrl: 'https://www.douyin.com/',
          navigateTo: `https://www.douyin.com/video/${encodeURIComponent(awemeId)}`,
        },
        { timeoutMs: DOUYIN_SITE_EVALUATE_TIMEOUT_MS },
      );
    } catch (err) {
      failures.push(`${browserContextId}: evaluate 调用失败：${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    try {
      if (!resp || !resp.ok || !resp.value || resp.value.ok === false) {
        failures.push(`${browserContextId}: ${resp?.value?.error ?? resp?.error ?? 'evaluate 未返回结果'}`);
        continue;
      }
      if (resp.value.challenge) {
        keepPageOpen = true;
        const focused = await focusDouyinScrapePage(config, resp.pageId);
        failures.push(`${browserContextId}: ${describeDouyinChallengePage(resp.value.title, focused)}`);
        continue;
      }
      const outcome = parseBrowserPayload(resp.value, awemeId);
      if (outcome.ok) return outcome;
      failures.push(`${browserContextId}: ${outcome.reason}`);
    } finally {
      if (!keepPageOpen) {
        await closeDouyinScrapePage(config, resp?.pageId);
      }
    }
  }
  return {
    ok: false,
    phase: 'risk',
    reason: failures.length > 0 ? failures.join('；') : '没有可用浏览器上下文重采该视频。',
  };
}

/**
 * Back-fill one aweme's metadata, resilient to anti-bot rate-limiting:
 *   1. anonymous HTTP (paced)
 *   2. on `risk` skeleton → logged-in browser fetch share page
 *   3. on `risk` still → real browser tab navigate /video/<id>
 *      (slowest, most expensive, requires renderable page — used last;
 *       see video-page-browser-scrape.ts for the why)
 * A genuinely gone video (parse/extract/http) is returned as-is — neither
 * fallback can recover it and retrying would only waste a navigation.
 */
export async function fetchVideoMetadataResilient(
  awemeId: string,
): Promise<ScrapeOutcome> {
  const anon = await paced(() => fetchVideoMetadata(awemeId));
  // 半骨架判定: anonymous fetch ok=true 但 metadata 既没 play_addr 也没
  // native subtitle —— transcribe 阶段必然失败 "该视频既没原生字幕也没
  // play_addr URL"。把它视同 risk 让 layer-2/3 兜底拿真 URL, 比直接 ok=true
  // 浪费下游 pipeline 强。fetchVideoMetadata 自身保持原行为不改, 这里只在
  // 链式调用入口加诚实重试。
  const anonHasMedia =
    anon.ok &&
    anon.metadata &&
    (anon.metadata.playAddrUrls.length > 0 || anon.metadata.nativeSubtitleUrls.length > 0);
  if (anon.ok && anonHasMedia) return anon;
  if (!anon.ok && anon.phase !== 'risk') return anon;

  const viaBrowser = await fetchVideoMetadataViaBrowser(awemeId);
  // 同 anon 半骨架判: layer-2 ok=true 但 metadata 空 play_addr+原生字幕 时
  // 也继续走 layer-3 navigate detail, 否则 transcribe 必失败。
  const viaBrowserHasMedia =
    viaBrowser.ok &&
    viaBrowser.metadata &&
    (viaBrowser.metadata.playAddrUrls.length > 0 || viaBrowser.metadata.nativeSubtitleUrls.length > 0);
  if (viaBrowser.ok && viaBrowserHasMedia) return viaBrowser;

  // Layer-3 fallback: real tab navigate to /video/<id>. Slow + may trigger
  // captcha, but on 130+-video creators where 22 share pages got hard-
  // skeleton'd this is the only path that recovers them.
  const viaPage = await fetchVideoMetadataViaBrowserPage(awemeId);
  if (viaPage.ok && viaPage.metadata) {
    return { ok: true, metadata: viaPage.metadata };
  }
  const anonReason = anon.ok
    ? '匿名 fetch 半骨架（无 play_addr/原生字幕）'
    : anon.reason;
  const viaBrowserPhase = viaBrowser.ok ? 'risk' : viaBrowser.phase;
  const viaBrowserReason = viaBrowser.ok
    ? '登录浏览器拿到半骨架（无 play_addr/原生字幕）'
    : viaBrowser.reason;
  if (viaPage.challenge) {
    return {
      ok: false,
      phase: 'risk',
      reason: `${anonReason}（详情页打开触发验证码：${viaPage.reason}）`,
    };
  }
  return {
    ok: false,
    phase: viaBrowserPhase,
    reason: `${anonReason}（登录浏览器重采：${viaBrowserReason}；详情页兜底：${viaPage.reason}）`,
  };
}
