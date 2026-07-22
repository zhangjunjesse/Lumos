import type { AppDataStore } from '@/lib/app/runtime/data-store';

import { TOP_N } from './constants';

/**
 * 提取规则数据化：代码引擎的页内提取脚本不再写死，而是由「结构化规则」生成。
 * 出厂基线是内置常量（版本 0）；AI 操作模式发现规则失效时会生成新版本草稿，
 * 用户在设置页确认采用后代码引擎切换到新规则，随时可回滚出厂。
 *
 * 规则里的选择器/标记全部作为 JSON 数据注入脚本（不拼接可执行代码），
 * 文本匹配统一是「小写包含」，不用正则——AI 提案不会引入语法崩溃或注入。
 */

export const RULES_COLLECTION = 'extraction_rules';

export interface ExtractionRuleSet {
  /** 搜索结果卡片选择器 */
  resultSelector: string;
  /** 卡片上携带 ASIN 的属性名 */
  asinAttribute: string;
  /** 卡片 innerHTML 含任一标记 → 广告位（区分大小写，对应页面源码） */
  adTextMarkers: string[];
  /** 卡片 class 含任一 → 广告位 */
  adClassMarkers: string[];
  /** 卡片内命中任一选择器 → 广告位 */
  adLabelSelectors: string[];
  /** 标题+正文（小写）含任一 → 无搜索结果 */
  noResultsPatterns: string[];
  /** 页面命中任一选择器 → 验证码 */
  captchaSelectors: string[];
  /** 标题+正文（小写）含任一 → 验证码 */
  captchaTextPatterns: string[];
}

export type RuleStatus = 'draft' | 'active' | 'archived';

export interface ExtractionRulesRow extends Record<string, unknown> {
  id: string;
  version: number;
  status: RuleStatus;
  rules: ExtractionRuleSet;
  /** AI 给出的改动理由，展示给用户辅助决策 */
  note?: string;
  /** 提案时在哪些关键词的真实页面上验证通过 */
  validated_keywords: string[];
  created_at: string;
  updated_at: string;
}

export const BUILTIN_RULES_VERSION = 0;

export const BUILTIN_RULES: ExtractionRuleSet = {
  resultSelector: '[data-component-type="s-search-result"]',
  asinAttribute: 'data-asin',
  adTextMarkers: ['Sponsored', 'AdHolder'],
  adClassMarkers: ['sg-col-20-of-24'],
  adLabelSelectors: ['.puis-sponsored-label-text'],
  noResultsPatterns: ['did not match any products', 'no results for'],
  captchaSelectors: ['#captchacharacters'],
  captchaTextPatterns: ['robot check', 'enter the characters you see below'],
};

const MAX_SELECTOR_LEN = 300;
const MAX_MARKER_LEN = 200;
const MAX_LIST_ITEMS = 10;

function sanitizeList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_MARKER_LEN) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

function sanitizeString(value: unknown, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed && trimmed.length <= MAX_SELECTOR_LEN ? trimmed : fallback;
}

/** 规则集清洗：类型/长度/数量上限，关键字段空值回退出厂基线 */
export function sanitizeRuleSet(raw: Partial<ExtractionRuleSet> | undefined): ExtractionRuleSet {
  const b = BUILTIN_RULES;
  return {
    resultSelector: sanitizeString(raw?.resultSelector, b.resultSelector),
    asinAttribute: sanitizeString(raw?.asinAttribute, b.asinAttribute),
    adTextMarkers: sanitizeList(raw?.adTextMarkers, b.adTextMarkers),
    adClassMarkers: sanitizeList(raw?.adClassMarkers, b.adClassMarkers),
    adLabelSelectors: sanitizeList(raw?.adLabelSelectors, b.adLabelSelectors),
    noResultsPatterns: sanitizeList(raw?.noResultsPatterns, b.noResultsPatterns),
    captchaSelectors: sanitizeList(raw?.captchaSelectors, b.captchaSelectors),
    captchaTextPatterns: sanitizeList(raw?.captchaTextPatterns, b.captchaTextPatterns),
  };
}

/**
 * 由规则集生成页内提取脚本。规则经 JSON.stringify 注入为数据；
 * 选择器执行包 try——坏选择器只会让对应信号缺失，不会让脚本崩掉。
 */
export function buildExtractSignalsScript(rules: ExtractionRuleSet, topN: number = TOP_N): string {
  const injected = JSON.stringify(sanitizeRuleSet(rules));
  return `(() => {
  const R = ${injected};
  const q = (root, sel) => { try { return root.querySelector(sel); } catch { return null; } };
  let items = [];
  try { items = Array.from(document.querySelectorAll(R.resultSelector)); } catch { items = []; }
  const organic = [];
  for (let i = 0; i < items.length && organic.length < ${Math.max(1, Math.floor(topN))}; i++) {
    const el = items[i];
    const asin = (el.getAttribute(R.asinAttribute) || '').trim();
    const html = el.innerHTML;
    const isAd = R.adTextMarkers.some((m) => html.includes(m))
      || R.adClassMarkers.some((c) => el.classList.contains(c))
      || R.adLabelSelectors.some((sel) => !!q(el, sel));
    if (asin && !isAd) organic.push(asin);
  }
  const hay = (document.title + '\\n' + ((document.body && document.body.innerText) || '').slice(0, 4000)).toLowerCase();
  const captcha = R.captchaSelectors.some((sel) => !!q(document, sel))
    || R.captchaTextPatterns.some((p) => hay.includes(p.toLowerCase()));
  const noResults = R.noResultsPatterns.some((p) => hay.includes(p.toLowerCase()));
  return JSON.stringify({
    organicAsins: organic,
    resultNodeCount: items.length,
    captcha: captcha,
    noResults: noResults,
  });
})()`;
}

export interface ActiveRulesInfo {
  version: number;
  source: 'builtin' | 'ai';
  rules: ExtractionRuleSet;
}

function listRows(store: AppDataStore): ExtractionRulesRow[] {
  return store.query<ExtractionRulesRow>(RULES_COLLECTION, {
    orderBy: { field: 'version', direction: 'desc' },
  });
}

export function getActiveRules(store: AppDataStore): ActiveRulesInfo {
  const active = listRows(store).find((r) => r.status === 'active');
  if (!active) {
    return { version: BUILTIN_RULES_VERSION, source: 'builtin', rules: { ...BUILTIN_RULES } };
  }
  return { version: active.version, source: 'ai', rules: sanitizeRuleSet(active.rules) };
}

export function getDraftRules(store: AppDataStore): ExtractionRulesRow | null {
  return listRows(store).find((r) => r.status === 'draft') ?? null;
}

/** 保存新草稿；同时把旧草稿归档（同一时刻最多一份待确认草稿） */
export function saveDraftRules(
  store: AppDataStore,
  rules: Partial<ExtractionRuleSet>,
  meta: { note?: string; validatedKeywords: string[] },
): ExtractionRulesRow {
  const now = new Date().toISOString();
  for (const row of listRows(store)) {
    if (row.status === 'draft') {
      store.update<ExtractionRulesRow>(RULES_COLLECTION, row.id, { status: 'archived', updated_at: now });
    }
  }
  const nextVersion = Math.max(BUILTIN_RULES_VERSION, ...listRows(store).map((r) => r.version)) + 1;
  return store.create<ExtractionRulesRow>(RULES_COLLECTION, {
    version: nextVersion,
    status: 'draft',
    rules: sanitizeRuleSet(rules),
    note: meta.note,
    validated_keywords: meta.validatedKeywords.slice(0, 50),
    created_at: now,
    updated_at: now,
  } as unknown as ExtractionRulesRow);
}

/** 采用草稿：现役规则归档，草稿转正 */
export function adoptDraftRules(store: AppDataStore, draftId: string): ExtractionRulesRow {
  const draft = store.get<ExtractionRulesRow>(RULES_COLLECTION, draftId);
  if (!draft || draft.status !== 'draft') {
    throw new Error('草稿不存在或已被处理');
  }
  const now = new Date().toISOString();
  for (const row of listRows(store)) {
    if (row.status === 'active') {
      store.update<ExtractionRulesRow>(RULES_COLLECTION, row.id, { status: 'archived', updated_at: now });
    }
  }
  const adopted = store.update<ExtractionRulesRow>(RULES_COLLECTION, draftId, { status: 'active', updated_at: now });
  if (!adopted) throw new Error('草稿采用失败：记录不存在');
  return adopted;
}

export function dismissDraftRules(store: AppDataStore, draftId: string): void {
  const draft = store.get<ExtractionRulesRow>(RULES_COLLECTION, draftId);
  if (!draft || draft.status !== 'draft') return;
  store.update<ExtractionRulesRow>(RULES_COLLECTION, draftId, {
    status: 'archived',
    updated_at: new Date().toISOString(),
  });
}

/** 回滚出厂基线：所有现役 AI 规则归档 */
export function rollbackToBuiltinRules(store: AppDataStore): void {
  const now = new Date().toISOString();
  for (const row of listRows(store)) {
    if (row.status === 'active') {
      store.update<ExtractionRulesRow>(RULES_COLLECTION, row.id, { status: 'archived', updated_at: now });
    }
  }
}
