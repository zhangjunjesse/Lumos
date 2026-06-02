// 二创·拆解(vision,严格对齐 playbook Step1-3 / 6 / 7):看参考印花,产出结构化 JSON ——
//   type/layout/ownership/ip_risk + facts(原图事实) + semantics(语义抽象) + niches(3-5 候选) + hooks(图像定制创意钩子) + palettes(2-3 配色方案)。
// 本地印花用 base64 喂;解析尽量宽容,缺的字段降级,由 runRemix 兜底(不 mock,失败如实记)。

import type { FetchedImage } from './image-fetch';
import { visionChat } from './vision-chat';
import type { VisionEndpoint } from './vision-provider';

const ANALYZE_TIMEOUT_MS = 120_000; // 大 JSON,给足时间

export type RemixType = 'graphic' | 'text' | 'combo';
export type RemixLayout = 'single-hero' | 'pattern' | 'typographic' | 'badge';
export type Ownership = 'owned' | 'licensed' | 'unsure' | 'not-owned';

export interface NicheHypothesis {
  buyer: string;
  useCase: string;
  emotion: string;
  visualTheme: string;
  searchIntent: string;
  searchTerms: string;
  match: string; // 与原图匹配度
  potential: string; // 商业潜力
  risk: string;
}
export interface CreativeHook {
  operator: string; // 用了哪个算子
  keep: string;
  change: string;
  buyerEmotion: string;
  threeSec: string; // 3 秒识别点
}
export interface PaletteSolution {
  name: string;
  colors: string; // 主色/辅色/对比色
  shirtColor: string; // 适合的衣服底色
  note: string;
}

export interface RemixAnalysis {
  type: RemixType;
  layout: RemixLayout;
  ownership: Ownership;
  ipRisk: string;
  facts: Record<string, string>; // Step1
  semantics: Record<string, string>; // Step2
  niches: NicheHypothesis[]; // Step3
  hooks: CreativeHook[]; // Step6
  palettes: PaletteSolution[]; // Step7
}

const TYPES: RemixType[] = ['graphic', 'text', 'combo'];
const LAYOUTS: RemixLayout[] = ['single-hero', 'pattern', 'typographic', 'badge'];
const OWNERSHIPS: Ownership[] = ['owned', 'licensed', 'unsure', 'not-owned'];
const S = (v: unknown): string => (v == null ? '' : String(v).trim());

function parse(raw: string): RemixAnalysis {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('拆解未返回 JSON');
  const j = JSON.parse(m[0]) as Record<string, unknown>;
  const obj = (v: unknown): Record<string, string> => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).map(([k, val]) => [k, S(val)]));
  };
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    type: TYPES.includes(j.type as RemixType) ? (j.type as RemixType) : 'graphic',
    layout: LAYOUTS.includes(j.layout as RemixLayout) ? (j.layout as RemixLayout) : 'single-hero',
    ownership: OWNERSHIPS.includes(j.ownership as Ownership) ? (j.ownership as Ownership) : 'not-owned',
    ipRisk: S(j.ip_risk),
    facts: obj(j.facts),
    semantics: obj(j.semantics),
    niches: arr(j.niches).map((n) => ({
      buyer: S(n.buyer), useCase: S(n.use_case), emotion: S(n.emotion), visualTheme: S(n.visual_theme),
      searchIntent: S(n.search_intent), searchTerms: S(n.search_terms), match: S(n.match), potential: S(n.potential), risk: S(n.risk),
    })).filter((n) => n.buyer || n.visualTheme),
    hooks: arr(j.hooks).map((h) => ({
      operator: S(h.operator), keep: S(h.keep), change: S(h.change), buyerEmotion: S(h.buyer_emotion), threeSec: S(h.three_sec),
    })).filter((h) => h.change || h.operator),
    palettes: arr(j.palettes).map((p) => ({ name: S(p.name), colors: S(p.colors), shirtColor: S(p.shirt_color), note: S(p.note) }))
      .filter((p) => p.colors),
  };
}

export async function analyzeForRemix(ep: VisionEndpoint, designImg: FetchedImage, prompt: string): Promise<RemixAnalysis> {
  const content = await visionChat(ep, designImg, prompt, 2200, ANALYZE_TIMEOUT_MS);
  const a = parse(content);
  if (Object.keys(a.facts).length === 0 && a.niches.length === 0) throw new Error('拆解 JSON 缺少 facts/niches');
  return a;
}

// 把 facts + semantics 拼成稳定的简报文本(喂变体 {brief});niche/hook/palette 逐张单独注入。
export function factsBriefText(a: RemixAnalysis): string {
  const lines: string[] = ['--- visual facts ---'];
  for (const [k, v] of Object.entries(a.facts)) if (v) lines.push(`${k.toUpperCase()}: ${v}`);
  lines.push('--- commercial meaning ---');
  for (const [k, v] of Object.entries(a.semantics)) if (v) lines.push(`${k.toUpperCase()}: ${v}`);
  return lines.join('\n');
}

// 单个 niche 假设 → 注入 {niche} 的文本(playbook Step3)。
export function nicheText(n: NicheHypothesis): string {
  return [
    `BUYER: ${n.buyer}`,
    n.useCase && `USE CASE: ${n.useCase}`,
    n.emotion && `EMOTION: ${n.emotion}`,
    n.visualTheme && `VISUAL THEME: ${n.visualTheme}`,
    n.searchIntent && `SEARCH INTENT: ${n.searchIntent}`,
  ].filter(Boolean).join('\n');
}

// 图像定制的创意钩子 → 注入 {hook} 的指令文本(playbook Step6)。
export function hookText(h: CreativeHook): string {
  return [
    `Creative hook — ${h.operator || 'remix'}:`,
    h.keep && `keep ${h.keep};`,
    h.change && `change ${h.change};`,
    h.buyerEmotion && `buyer emotion: ${h.buyerEmotion};`,
    h.threeSec && `3-second read: ${h.threeSec}.`,
  ].filter(Boolean).join(' ');
}

// 配色方案 → 注入 {palette} 的文本(playbook Step7)。
export function paletteText(p: PaletteSolution): string {
  return [p.name && `[${p.name}]`, p.colors, p.shirtColor && `on a ${p.shirtColor} shirt`, p.note && `— ${p.note}`]
    .filter(Boolean)
    .join(' ');
}

// 拆解失败时的兜底:用商品标题拼一个最小可用的 analysis(不 mock,如实标注降级)。
export function fallbackAnalysis(title: string): RemixAnalysis {
  return {
    type: 'graphic',
    layout: 'single-hero',
    ownership: 'not-owned',
    ipRisk: '',
    facts: { subject: `based on product title "${title || '(none)'}"`, line_render: 'match the reference image style' },
    semantics: {},
    niches: [],
    hooks: [],
    palettes: [],
  };
}
