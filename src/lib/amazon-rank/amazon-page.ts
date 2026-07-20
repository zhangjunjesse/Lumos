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
  evaluate<T = unknown>(script: string): Promise<T>;
}

// 打开定位入口。部分会话会自动弹「Choose your location」模态——已开就别再点,
// 否则再点定位入口反而会把模态切换关闭。
const OPEN_LOCATION_SCRIPT = `(() => {
  if (document.querySelector('#GLUXZipUpdateInput')) return 'already-open';
  const link = document.querySelector('#nav-global-location-popover-link')
    || document.querySelector('#glow-ingress-block');
  if (!link) return 'no-link';
  link.click();
  return 'clicked';
})()`;

// #GLUXZipUpdate = Apply 按钮。GLUX 的 submit 按钮接受页内(非可信)click——
// 已在真实 amazon.com 验证:填框 → 点 Apply → 点 Done,ingress 从默认 90009 变为设定邮编。
const CLICK_APPLY_SCRIPT = `(() => {
  const btn = document.querySelector('#GLUXZipUpdate .a-button-input')
    || document.querySelector('#GLUXZipUpdate input')
    || document.querySelector('#GLUXZipUpdate');
  if (!btn) return 'no-apply';
  btn.click();
  return 'applied';
})()`;

// glowDoneButton = Done 关闭按钮。必须点掉,否则模态遮罩残留会挡住后续每个关键词的搜索。
const CLICK_DONE_SCRIPT = `(() => {
  const done = document.querySelector('[name="glowDoneButton"] .a-button-input')
    || document.querySelector('[name="glowDoneButton"]')
    || document.querySelector('#GLUXConfirmClose .a-button-input')
    || document.querySelector('#GLUXConfirmClose');
  if (!done) return 'no-done';
  done.click();
  return 'done';
})()`;

function buildFillZipScript(zip: string): string {
  return `(() => {
    const input = document.querySelector('#GLUXZipUpdateInput');
    if (!input) return 'no-input';
    input.focus();
    input.value = ${JSON.stringify(zip)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'filled';
  })()`;
}

/**
 * 把配送地址锁定到指定邮编（排名随配送地变化，固定邮编结果才可比）。
 *
 * 亚马逊给未登录 / 机房 IP 会话弹的是「Choose your location」模态，交互是：
 * 填 #GLUXZipUpdateInput → 点 Apply(#GLUXZipUpdate) → 点 Done(glowDoneButton) 关闭。
 * 旧实现照旧版小浮层写（填完按 Enter、从不关弹窗），对不上这个模态：邮编设不上、
 * 且残留的模态遮罩会挡住后续每个关键词的搜索（表现为全部 parse_failed）。
 * 失败不阻断运行；但无论成否都要点 Done 关弹窗。全程走页内脚本，已在真实站点验证。
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

  await api.evaluate(OPEN_LOCATION_SCRIPT).catch(() => undefined);
  try {
    await api.waitFor(['zip code', 'ZIP'], { timeout: 15_000 });
  } catch {
    await sleep(4_000);
  }

  // 填邮编 → 点 Apply → 等 AJAX 生效（实测 ~2.5s，ingress 到点 Done/刷新后才更新）。
  await api.evaluate(buildFillZipScript(zip)).catch(() => undefined);
  await sleep(400);
  await api.evaluate(CLICK_APPLY_SCRIPT).catch(() => undefined);
  await sleep(2_500);

  // 关弹窗（无论邮编设成没设成都要关，否则遮罩挡住后续搜索）。
  await api.evaluate(CLICK_DONE_SCRIPT).catch(() => undefined);
  await sleep(1_200);

  try {
    const after = await api.snapshot();
    return after.content.includes(zip);
  } catch {
    return false;
  }
}
