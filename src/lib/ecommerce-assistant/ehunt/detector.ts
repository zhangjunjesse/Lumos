import { normalizeBrowserContextId } from '@/lib/browser-provider/labels';
import { resolveEhuntBridgeConfig, evaluateOnPage } from './bridge-page';
import { EHUNT_EXTENSION_ID, type EhuntDetectionResult } from './types';

/** browserContextId 是否指向 AdsPower profile。 */
export function isAdsPowerContext(browserContextId?: string | null): boolean {
  return normalizeBrowserContextId(browserContextId).startsWith('adspower:');
}

/**
 * 在当前页面探测 EHunt 注入痕迹。EHunt 不用普通 class/iframe，
 * 这里用三类强信号联合判定：面板标题、EHunt 专有指标标签、扩展资源引用。
 * 任一命中即视为已注入（注入是渐进的，宽松判定避免误报"未接入"）。
 */
const EHUNT_PRESENCE_EXPRESSION = `(() => {
  const bodyText = document.body ? (document.body.innerText || '') : '';
  const marker = /EHunt\\s*-\\s*Etsy Rank Tool|Batch Analysis|Intelligent Review Analysis/i.test(bodyText);
  const metricLabels = /Store\\s+Weekly\\s+Sales\\s*:|Sales\\s*:\\s*[\\d.,]+\\s*[KkMm]?\\+?\\s*(?:\\(\\s*[\\d.,]+\\s*[KkMm]?\\+?\\s*\\))?|Favorites\\s*:|AI Insights|Avg\\.?Conv\\.?Rate/i.test(bodyText);
  let extensionResource = false;
  const sel = 'link[href^="chrome-extension://"],script[src^="chrome-extension://"],img[src^="chrome-extension://"]';
  for (const el of document.querySelectorAll(sel)) {
    const u = el.href || el.src || '';
    if (u.indexOf('${EHUNT_EXTENSION_ID}') !== -1) { extensionResource = true; break; }
  }
  return { marker, metricLabels, extensionResource, present: marker || metricLabels || extensionResource };
})()`;

/**
 * 综合 browserContextId + 已打开页面，判定 EHunt 指标是否可用。
 * 永远返回结构化结果（含面向 UI 的中文原因），不抛探测层错误。
 */
export async function detectEhunt(
  browserContextId: string,
  pageId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EhuntDetectionResult> {
  if (!isAdsPowerContext(browserContextId)) {
    return {
      isAdsPowerContext: false,
      ehuntDetected: false,
      status: 'not_adspower',
      reason: '当前浏览器上下文不是 AdsPower profile；EHunt 指标需在「设置 → 浏览器」选择已安装 EHunt 的 AdsPower profile。',
    };
  }

  const config = resolveEhuntBridgeConfig(browserContextId);
  if (!config) {
    return {
      isAdsPowerContext: true,
      ehuntDetected: false,
      status: 'bridge_unavailable',
      reason: 'Browser Bridge 未连接，请确认 Lumos 桌面端浏览器运行时已启动。',
    };
  }

  try {
    const value = await evaluateOnPage<{ present?: unknown }>(
      config, pageId, EHUNT_PRESENCE_EXPRESSION, { signal: opts.signal, timeoutMs: 15_000 },
    );
    const present = Boolean(value && typeof value === 'object' && value.present === true);
    if (present) {
      return { isAdsPowerContext: true, ehuntDetected: true, status: 'ok', reason: '已接入 EHunt。' };
    }
    return {
      isAdsPowerContext: true,
      ehuntDetected: false,
      status: 'no_ehunt',
      reason: '未接入 EHunt（需 AdsPower + 已安装 EHunt 扩展，并已打开 Etsy 页面）。',
    };
  } catch (error) {
    return {
      isAdsPowerContext: true,
      ehuntDetected: false,
      status: 'failed',
      reason: `EHunt 探测失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
