import { TOP_N } from './constants';
import type { KeywordStatus, PageExtractSignals } from './types';

/**
 * 亚马逊搜索页的 DOM 提取与状态分类。
 * 提取规则移植自已验证可跑的工作流脚本：自然位 = s-search-result 节点里
 * 排除 Sponsored / AdHolder / 横幅广告列后的前 TOP_N 个 data-asin。
 */

export function buildSearchUrl(site: string, keyword: string): string {
  return `https://${site}/s?k=${encodeURIComponent(keyword)}`;
}

/** 页面里执行的提取脚本：一次拿回分类所需的全部信号（JSON 字符串） */
export const EXTRACT_SIGNALS_SCRIPT = `(() => {
  const items = document.querySelectorAll('[data-component-type="s-search-result"]');
  const organic = [];
  for (let i = 0; i < items.length && organic.length < ${TOP_N}; i++) {
    const el = items[i];
    const asin = (el.getAttribute('data-asin') || '').trim();
    const html = el.innerHTML;
    const isAd = html.includes('Sponsored')
      || html.includes('AdHolder')
      || el.classList.contains('sg-col-20-of-24')
      || !!el.querySelector('.puis-sponsored-label-text');
    if (asin && !isAd) organic.push(asin);
  }
  const bodyText = ((document.body && document.body.innerText) || '').slice(0, 4000);
  const captcha = !!document.querySelector('#captchacharacters')
    || /robot check/i.test(document.title)
    || /enter the characters you see below/i.test(bodyText);
  const noResults = /did not match any products|no results for/i.test(bodyText);
  return JSON.stringify({
    organicAsins: organic,
    resultNodeCount: items.length,
    captcha: captcha,
    noResults: noResults,
  });
})()`;

export const OUTER_HTML_SCRIPT = '(() => document.documentElement.outerHTML)()';

export function parseExtractSignals(raw: unknown): PageExtractSignals | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PageExtractSignals>;
    return {
      organicAsins: Array.isArray(parsed.organicAsins)
        ? parsed.organicAsins.filter((a): a is string => typeof a === 'string' && !!a.trim())
        : [],
      resultNodeCount: typeof parsed.resultNodeCount === 'number' ? parsed.resultNodeCount : 0,
      captcha: parsed.captcha === true,
      noResults: parsed.noResults === true,
    };
  } catch {
    return null;
  }
}

export function classifySignals(
  signals: PageExtractSignals | null,
): { status: Extract<KeywordStatus, 'ok' | 'no_results' | 'blocked' | 'parse_failed'>; message?: string } {
  if (!signals) {
    return { status: 'parse_failed', message: '提取脚本没有返回有效数据（页面可能未加载完成）' };
  }
  if (signals.captcha) {
    return { status: 'blocked', message: '亚马逊返回了验证码页（Robot Check），疑似触发风控' };
  }
  if (signals.organicAsins.length > 0) {
    return { status: 'ok' };
  }
  if (signals.noResults) {
    return { status: 'no_results', message: '亚马逊提示没有匹配的商品' };
  }
  if (signals.resultNodeCount === 0) {
    return { status: 'parse_failed', message: '页面上没有搜索结果节点，亚马逊可能改版或页面未加载完成' };
  }
  return { status: 'parse_failed', message: '搜索结果全部被判为广告位，自然位提取规则可能失效' };
}

interface ZipBrowser {
  waitFor(texts: string | string[], options?: { timeout?: number }): Promise<void>;
  snapshot(): Promise<{ title: string; content: string; url?: string }>;
  click(target: string | { text: string }): Promise<void>;
  evaluate<T = unknown>(script: string): Promise<T>;
  press(key: string): Promise<void>;
}

/**
 * 把配送地址锁定到指定邮编（排名随配送地变化，固定邮编结果才可比）。
 * 流程移植自已验证脚本：点 Deliver → 聚焦 GLUX 输入框 → 逐键输入 → Enter。
 * 失败不阻断运行，返回 false 由调用方如实记录。
 */
export async function ensureDeliveryZip(
  api: ZipBrowser,
  zip: string,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  try {
    await api.waitFor('Amazon', { timeout: 60_000 });
  } catch {
    await sleep(8_000);
  }

  const before = await api.snapshot();
  if (before.content.includes(zip)) return true;

  try {
    await api.click({ text: 'Deliver' });
  } catch {
    return false;
  }
  try {
    await api.waitFor(['zip code', 'ZIP'], { timeout: 15_000 });
  } catch {
    await sleep(4_000);
  }

  await api.evaluate("document.querySelector('#GLUXZipUpdateInput')?.focus()");
  await sleep(300);
  for (const ch of zip.split('')) {
    await api.press(ch);
    await sleep(100);
  }
  await api.press('Enter');
  try {
    await api.waitFor(zip, { timeout: 30_000 });
  } catch {
    await sleep(8_000);
  }

  try {
    const after = await api.snapshot();
    return after.content.includes(zip);
  } catch {
    return false;
  }
}
