import {
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
  type BrowserBridgeResponse,
  type BrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';

/**
 * EHunt 各采集环节共用的 Browser Bridge 页生命周期 + evaluate 封装。
 * 集中一处，避免 detector / metrics-extract / etsy-reviews 各写一份（项目规范：禁止复制粘贴）。
 * 全程 background:true —— 自动化不得抢用户前台 tab。
 */

export const EHUNT_BRIDGE_LOCK_OWNER = 'ecommerce-ehunt';
const BACKGROUND = true;
const NEW_PAGE_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 10_000;
const RELEASE_TIMEOUT_MS = 10_000;

interface BridgeNewPageResponse extends BrowserBridgeResponse {
  pageId?: string;
}
interface BridgeEvaluateResponse extends BrowserBridgeResponse {
  value?: unknown;
  result?: unknown;
}

/** 解析 bridge 运行时配置；未连接返回 null（调用方据此给出可见原因，不抛）。 */
export function resolveEhuntBridgeConfig(browserContextId: string): BrowserBridgeRuntimeConfig | null {
  return resolveBrowserBridgeRuntimeConfig({ browserContextId, lockOwnerId: EHUNT_BRIDGE_LOCK_OWNER });
}

/** 后台打开页面，返回 pageId；失败返回 null。 */
export async function openBridgePage(
  config: BrowserBridgeRuntimeConfig,
  url: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string | null> {
  const created = await postToBrowserBridge<BridgeNewPageResponse>(
    config,
    '/v1/pages/new',
    { url, background: BACKGROUND },
    { signal: opts.signal, timeoutMs: NEW_PAGE_TIMEOUT_MS },
  );
  return typeof created.pageId === 'string' && created.pageId.trim() ? created.pageId : null;
}

/** 在指定页执行表达式，返回 value（或 result）。 */
export async function evaluateOnPage<T>(
  config: BrowserBridgeRuntimeConfig,
  pageId: string,
  expression: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T | null> {
  const res = await postToBrowserBridge<BridgeEvaluateResponse>(
    config,
    '/v1/pages/evaluate',
    { pageId, expression, background: BACKGROUND },
    { signal: opts.signal, timeoutMs: opts.timeoutMs ?? 20_000 },
  );
  return (res.value ?? res.result ?? null) as T | null;
}

/** 关闭页面，吞掉关闭异常（清理不应影响主流程结果）。 */
export async function closeBridgePage(config: BrowserBridgeRuntimeConfig, pageId: string): Promise<void> {
  try {
    await postToBrowserBridge(
      config,
      '/v1/pages/close',
      { pageId, background: BACKGROUND },
      { timeoutMs: CLOSE_TIMEOUT_MS },
    );
  } catch {
    // Cleanup is best effort; callers still need the structured collect result.
  }
}

/** 释放 EHunt 本轮自动化占用的浏览器上下文租约。 */
export async function releaseBridgeContext(config: BrowserBridgeRuntimeConfig): Promise<void> {
  try {
    await postToBrowserBridge(
      config,
      '/v1/context/release',
      {},
      { timeoutMs: RELEASE_TIMEOUT_MS },
    );
  } catch {
    // Do not turn a lease cleanup failure into an EHunt collection failure.
  }
}
