import { detectEhunt } from './detector';
import { extractListMetrics } from './metrics-extract';
import { collectEtsyReviews } from './etsy-reviews';
import { resolveEhuntBridgeConfig, openBridgePage, closeBridgePage, releaseBridgeContext } from './bridge-page';
import type { EhuntDetectionResult, EhuntMetrics, EtsyReviewBundle } from './types';

/**
 * EHunt 选品采集编排层 —— 选品/采集流程的唯一调用入口。
 *
 * 职责边界（见 docs/ecommerce-ehunt-review-intel-guide.md §5）：
 * - 指标增强：仅 AdsPower 上下文 + 页面检测到 EHunt 时返回 metrics；否则 detection 带可见原因，metrics 为空，不 mock。
 * - 评论采集：走 Etsy 原生接口，**不依赖 EHunt**，任意已登录 Etsy 的浏览器上下文可用。
 * - 评论分析：不在此层触发（默认关闭、用户手动），见后续 review-analyze。
 */

export interface EhuntListCollectResult {
  detection: EhuntDetectionResult;
  /** listingId → EHunt 注入指标。仅 detection.ehuntDetected 时非空。 */
  metrics: Map<string, EhuntMetrics>;
}

const EHUNT_LIST_READY_TIMEOUT_MS = process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test' ? 500 : 45_000;
const EHUNT_LIST_READY_POLL_MS = process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test' ? 1 : 1_500;

/** 从 listing URL 解析 listingId（与 discover 的 MarketProductDetail.url 对齐）。 */
export function parseListingId(url: string): string | null {
  const m = url.match(/\/listing\/(\d+)/);
  return m ? m[1] : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

async function waitForListPageEhunt(
  browserContextId: string,
  pageId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EhuntListCollectResult> {
  const empty = new Map<string, EhuntMetrics>();
  const startedAt = Date.now();
  let lastDetection: EhuntDetectionResult | null = null;
  let detectedAtLeastOnce = false;

  while (Date.now() - startedAt < EHUNT_LIST_READY_TIMEOUT_MS) {
    const detection = await detectEhunt(browserContextId, pageId, opts);
    lastDetection = detection;

    if (detection.status === 'not_adspower' || detection.status === 'bridge_unavailable') {
      return { detection, metrics: empty };
    }

    if (detection.ehuntDetected) {
      detectedAtLeastOnce = true;
      const metrics = await extractListMetrics(browserContextId, pageId, opts);
      if (metrics.size > 0) {
        return { detection, metrics };
      }
    }

    await sleep(EHUNT_LIST_READY_POLL_MS, opts.signal);
  }

  if (detectedAtLeastOnce) {
    return {
      detection: {
        isAdsPowerContext: browserContextId.startsWith('adspower:'),
        ehuntDetected: false,
        status: 'failed',
        reason: `已检测到 EHunt 插件痕迹，但等待 ${Math.round(EHUNT_LIST_READY_TIMEOUT_MS / 1000)} 秒后仍未抽到商品卡指标；请确认 Etsy 列表页已完全加载且 EHunt 指标已显示。`,
      },
      metrics: empty,
    };
  }

  const waitedSeconds = Math.round(EHUNT_LIST_READY_TIMEOUT_MS / 1000);
  return {
    detection: lastDetection
      ? {
        ...lastDetection,
        reason: `已等待 ${waitedSeconds} 秒，仍未检测到 EHunt 注入或指标文本。${lastDetection.reason}`,
      }
      : {
      isAdsPowerContext: browserContextId.startsWith('adspower:'),
      ehuntDetected: false,
      status: 'no_ehunt',
      reason: `已等待 ${waitedSeconds} 秒，仍未检测到 EHunt 注入或指标文本。`,
    },
    metrics: empty,
  };
}

/**
 * 对一个列表/分类/搜索页做 EHunt 指标采集：后台开页 → 探测 → 命中则抽取 → 关页。
 * 永远返回结构化结果，失败原因在 detection 内可见。
 */
export async function collectListPageEhunt(
  browserContextId: string,
  listPageUrl: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EhuntListCollectResult> {
  const empty = new Map<string, EhuntMetrics>();
  const config = resolveEhuntBridgeConfig(browserContextId);
  if (!config) {
    return {
      detection: {
        isAdsPowerContext: browserContextId.startsWith('adspower:'),
        ehuntDetected: false,
        status: 'bridge_unavailable',
        reason: 'Browser Bridge 未连接，请确认 Lumos 桌面端浏览器运行时已启动。',
      },
      metrics: empty,
    };
  }

  let pageId: string | null = null;
  try {
    pageId = await openBridgePage(config, listPageUrl, opts);
    if (!pageId) {
      return {
        detection: { isAdsPowerContext: true, ehuntDetected: false, status: 'failed', reason: '浏览器打开页面后没有返回 pageId。' },
        metrics: empty,
      };
    }
    return await waitForListPageEhunt(browserContextId, pageId, opts);
  } catch (error) {
    return {
      detection: {
        isAdsPowerContext: browserContextId.startsWith('adspower:'),
        ehuntDetected: false,
        status: 'failed',
        reason: `EHunt 采集失败：${error instanceof Error ? error.message : String(error)}`,
      },
      metrics: empty,
    };
  } finally {
    try {
      if (pageId) await closeBridgePage(config, pageId);
    } finally {
      await releaseBridgeContext(config);
    }
  }
}

/**
 * 把 EHunt 指标合并进一组已采集的商品明细（按 listingId 对齐）。
 *
 * 泛型约束只要求 `{ url; ehunt? }`，避免本层反向依赖 web-research 的 MarketProductDetail，
 * 保持依赖方向 web-research → ehunt。永不抛错；返回 detection 供调用方做可见提示。
 * 仅做指标增强：评论采集/分析按文档 §5.2 是按需触发，不在发现期 blanket。
 */
export async function enrichListingDetailsWithEhunt<T extends { url: string; ehunt?: EhuntMetrics }>(
  details: T[],
  browserContextId: string,
  listPageUrl: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EhuntDetectionResult> {
  const { detection, metrics } = await collectListPageEhunt(browserContextId, listPageUrl, opts);
  if (metrics.size === 0) return detection;
  for (const d of details) {
    const id = parseListingId(d.url);
    if (id) {
      const m = metrics.get(id);
      if (m) d.ehunt = m;
    }
  }
  return detection;
}

/**
 * 单商品原始评论采集（独立于 EHunt）。薄封装 collectEtsyReviews，
 * 让选品流程只依赖本编排层一个模块。评论分析不在此触发。
 */
export async function collectProductReviews(
  listingUrl: string,
  browserContextId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EtsyReviewBundle> {
  return collectEtsyReviews(listingUrl, browserContextId, opts);
}
