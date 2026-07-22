/**
 * 通用页面摘要：给 AI 操作模式「看页面」用的原料。
 *
 * 关键约束：摘要脚本不能依赖待修复的提取规则（那正是会失效的东西），
 * 只用亚马逊改版也很难消失的通用信号：data-asin 属性、data-component-type
 * 属性、/dp/ 商品链接。三路兜底，任何一路存在 AI 就有得看。
 */

/** 摘要卡片数量上限（前 N 屏结果足够判定 Top20 自然位） */
const MAX_CARDS = 80;
/** 单卡片文本截断，控制 token 成本 */
const CARD_TEXT_LEN = 140;

export interface PageDigestCard {
  /** 页面文档序（结果排序的依据） */
  i: number;
  tag: string;
  /** data-component-type 属性值 */
  type: string;
  asin: string;
  /** class 截断，供 AI 识别广告位标记 */
  cls: string;
  text: string;
}

export interface PageDigest {
  title: string;
  url: string;
  bodyTextHead: string;
  cards: PageDigestCard[];
}

export const PAGE_DIGEST_SCRIPT = `(() => {
  const cards = [];
  const pushCard = (el, asin) => {
    if (cards.length >= ${MAX_CARDS}) return;
    cards.push({
      i: cards.length,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('data-component-type') || '',
      asin: asin,
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
      text: ((el.innerText || '')).replace(/\\s+/g, ' ').trim().slice(0, ${CARD_TEXT_LEN}),
    });
  };
  const seenEl = new Set();
  const primary = document.querySelectorAll('[data-asin], [data-component-type]');
  for (const el of primary) {
    if (cards.length >= ${MAX_CARDS}) break;
    if (seenEl.has(el)) continue;
    seenEl.add(el);
    const asin = (el.getAttribute('data-asin') || '').trim();
    pushCard(el, asin);
  }
  if (cards.filter((c) => c.asin).length === 0) {
    const seenAsin = new Set();
    const anchors = document.querySelectorAll('a[href*="/dp/"]');
    for (const a of anchors) {
      if (cards.length >= ${MAX_CARDS}) break;
      const m = (a.getAttribute('href') || '').match(/\\/dp\\/([A-Z0-9]{10})/);
      if (!m || seenAsin.has(m[1])) continue;
      seenAsin.add(m[1]);
      const holder = a.closest('div, li, article') || a;
      pushCard(holder, m[1]);
    }
  }
  return JSON.stringify({
    title: document.title,
    url: location.href,
    bodyTextHead: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').slice(0, 1500),
    cards: cards,
  });
})()`;

export function parsePageDigest(raw: unknown): PageDigest | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PageDigest>;
    if (!Array.isArray(parsed.cards)) return null;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      url: typeof parsed.url === 'string' ? parsed.url : '',
      bodyTextHead: typeof parsed.bodyTextHead === 'string' ? parsed.bodyTextHead : '',
      cards: parsed.cards.filter(
        (c): c is PageDigestCard => !!c && typeof c === 'object' && typeof (c as PageDigestCard).i === 'number',
      ),
    };
  } catch {
    return null;
  }
}
