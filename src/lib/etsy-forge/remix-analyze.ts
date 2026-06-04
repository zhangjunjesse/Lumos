// 二创·拆解(vision,严格对齐 playbook Step1-8):看参考印花 + 可选的真实评论验证数据(Step2.5),产出结构化 JSON ——
//   type/layout/ownership/ip_risk + facts(Step1) + semantics(Step2) + style_retention(Step4) + risk(Step6)
//   + niches(Step3,带 verified 标记) + hooks(Step6) + palette_constraints/palettes(Step7) + sticker_check(Step8)。
// 本地印花用 base64 喂;有评论时把验证段拼进 prompt 让 niche 收敛在真实买家上。解析尽量宽容,缺字段降级,由 runRemix 兜底(不 mock,失败如实记)。

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
  verified: string; // Step2.5:yes=有真实评论验证 / no=基于推断(仅日志内部用)
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
// Step7 配色约束:出配色方案前先解的约束问卷。
export interface PaletteConstraints {
  shirtColor: string; // 目标衣服底色
  thumbnailContrast: string; // 缩略图对比需求
  printComplexity: string; // 印刷复杂度
  keepColors: string; // 原图可保留色
  replaceColors: string; // 原图必须替换色
  targetMood: string;
  targetAudience: string;
  season: string; // 季节/节日
  dualShirt: string; // 是否需适配黑白两种底色
}
// Step8 贴纸化/印花化检查:7 项 yes/no,判断这张能不能干净做成印花。
export interface StickerCheck {
  removeBg: string;
  clearOutline: string;
  singleFocal: string;
  canSimplify: string;
  transparentOk: string;
  readableThumbnail: string;
  canSeries: string;
}
// Step4 风格保留目标:贴近原图风格的方向(A/B)要保留的具体风格词 + 必须避免的风格偏移词。
export interface StyleRetention {
  emotion: string;
  texture: string; // 笔触/材质
  linework: string; // 线条气质
  colorMood: string; // 配色气质
  lettering: string; // 字体气质
  avoid: string; // 必须避免的风格偏移词
}
// Step6 仿图风险评估:来源类型/独特构图风险/独特文案风险/可安全迁移/必须替换/目标相似度/推荐策略。
export interface RiskAssessment {
  sourceType: string;
  uniqueCompositionRisk: string;
  uniqueTextRisk: string;
  safeTransfer: string;
  mustReplace: string;
  targetSimilarity: string;
  strategy: string;
}

export interface RemixAnalysis {
  type: RemixType;
  layout: RemixLayout;
  ownership: Ownership;
  ipRisk: string;
  facts: Record<string, string>; // Step1
  semantics: Record<string, string>; // Step2
  styleRetention: StyleRetention; // Step4
  risk: RiskAssessment; // Step6
  niches: NicheHypothesis[]; // Step3
  hooks: CreativeHook[]; // Step6
  paletteConstraints: PaletteConstraints; // Step7
  palettes: PaletteSolution[]; // Step7
  stickerCheck: StickerCheck; // Step8
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
    styleRetention: ((): StyleRetention => {
      const s = (j.style_retention && typeof j.style_retention === 'object' ? j.style_retention : {}) as Record<string, unknown>;
      return { emotion: S(s.emotion), texture: S(s.texture), linework: S(s.linework), colorMood: S(s.color_mood), lettering: S(s.lettering), avoid: S(s.avoid) };
    })(),
    risk: ((): RiskAssessment => {
      const r = (j.risk && typeof j.risk === 'object' ? j.risk : {}) as Record<string, unknown>;
      return {
        sourceType: S(r.source_type), uniqueCompositionRisk: S(r.unique_composition_risk), uniqueTextRisk: S(r.unique_text_risk),
        safeTransfer: S(r.safe_transfer), mustReplace: S(r.must_replace), targetSimilarity: S(r.target_similarity), strategy: S(r.strategy),
      };
    })(),
    niches: arr(j.niches).map((n) => ({
      buyer: S(n.buyer), useCase: S(n.use_case), emotion: S(n.emotion), visualTheme: S(n.visual_theme),
      searchIntent: S(n.search_intent), searchTerms: S(n.search_terms), match: S(n.match), potential: S(n.potential), risk: S(n.risk), verified: S(n.verified),
    })).filter((n) => n.buyer || n.visualTheme),
    hooks: arr(j.hooks).map((h) => ({
      operator: S(h.operator), keep: S(h.keep), change: S(h.change), buyerEmotion: S(h.buyer_emotion), threeSec: S(h.three_sec),
    })).filter((h) => h.change || h.operator),
    paletteConstraints: ((): PaletteConstraints => {
      const c = (j.palette_constraints && typeof j.palette_constraints === 'object' ? j.palette_constraints : {}) as Record<string, unknown>;
      return {
        shirtColor: S(c.shirt_color), thumbnailContrast: S(c.thumbnail_contrast), printComplexity: S(c.print_complexity),
        keepColors: S(c.keep_colors), replaceColors: S(c.replace_colors), targetMood: S(c.target_mood),
        targetAudience: S(c.target_audience), season: S(c.season), dualShirt: S(c.dual_shirt),
      };
    })(),
    palettes: arr(j.palettes).map((p) => ({ name: S(p.name), colors: S(p.colors), shirtColor: S(p.shirt_color), note: S(p.note) }))
      .filter((p) => p.colors),
    stickerCheck: ((): StickerCheck => {
      const k = (j.sticker_check && typeof j.sticker_check === 'object' ? j.sticker_check : {}) as Record<string, unknown>;
      return {
        removeBg: S(k.remove_bg), clearOutline: S(k.clear_outline), singleFocal: S(k.single_focal), canSimplify: S(k.can_simplify),
        transparentOk: S(k.transparent_ok), readableThumbnail: S(k.readable_thumbnail), canSeries: S(k.can_series),
      };
    })(),
  };
}

// Step8 判定:关键项(清晰外轮廓/单一主视觉/缩略图可读/适合透明底)有几项是「否」→ 很难贴纸化、大概率不适合做主印花。
export function stickerConcerns(a: RemixAnalysis): string[] {
  const c = a.stickerCheck;
  const isNo = (v: string) => /^\s*(no|否|false)/i.test(v);
  const checks: [string, string][] = [
    ['清晰外轮廓', c.clearOutline],
    ['单一主视觉', c.singleFocal],
    ['缩略图可读', c.readableThumbnail],
    ['适合透明底', c.transparentOk],
  ];
  return checks.filter(([, v]) => isNo(v)).map(([label]) => label);
}

export async function analyzeForRemix(
  ep: VisionEndpoint,
  designImg: FetchedImage,
  prompt: string,
  validationSection?: string, // Step2.5 市场验证数据段(有真实评论才传),拼进 prompt 让 niche 收敛在真实买家上
): Promise<RemixAnalysis> {
  const full = validationSection ? `${prompt}\n\n${validationSection}` : prompt;
  const content = await visionChat(ep, designImg, full, 4000, ANALYZE_TIMEOUT_MS);
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

// 风格保留目标 → 注入 {styleRetention} 的文本(playbook Step4)。只在贴近原图的方向(A/B)调用;C/D 换风格不注入。
export function styleRetentionText(a: RemixAnalysis): string {
  const s = a.styleRetention;
  const keep = [
    s.emotion && `emotion: ${s.emotion}`,
    s.texture && `texture: ${s.texture}`,
    s.linework && `linework: ${s.linework}`,
    s.colorMood && `color mood: ${s.colorMood}`,
    s.lettering && `lettering: ${s.lettering}`,
  ].filter(Boolean).join('; ');
  const lines: string[] = [];
  if (keep) lines.push(`Style retention target — keep faithfully: ${keep}.`);
  if (s.avoid) lines.push(`Do NOT drift into these styles: ${s.avoid}.`);
  return lines.join('\n');
}

// 仿图风险 → 注入 {riskRule} 的约束文本(playbook Step6)。IP 走「剔除后照常出」:检测到就明确剔除 + 换原创元素。
export function buildRiskRule(a: RemixAnalysis): string {
  const r = a.risk;
  const lines: string[] = [];
  if (a.ipRisk)
    lines.push(
      `IP / brand risk to REMOVE: ${a.ipRisk}. Do NOT reproduce any celebrity likeness, brand logo, team mark, copyrighted character or copyrighted wording — remove it entirely and replace with an original, non-infringing element that serves the same role.`,
    );
  if (r.uniqueCompositionRisk) lines.push(`Do NOT copy this distinctive composition/layout: ${r.uniqueCompositionRisk}; arrange it differently.`);
  if (r.uniqueTextRisk) lines.push(`Do NOT reuse this exact wording: ${r.uniqueTextRisk}; write an original phrase with the same tone.`);
  if (r.mustReplace) lines.push(`MUST change (do not copy from the reference): ${r.mustReplace}.`);
  if (r.safeTransfer) lines.push(`You may safely carry over only: ${r.safeTransfer}.`);
  return lines.join('\n');
}

// 配色约束 → 注入 {paletteConstraints} 的文本(playbook Step7,出方案前的约束)。
export function paletteConstraintsText(a: RemixAnalysis): string {
  const c = a.paletteConstraints;
  const parts = [
    c.shirtColor && `target shirt color: ${c.shirtColor}`,
    c.thumbnailContrast && `thumbnail contrast: ${c.thumbnailContrast}`,
    c.printComplexity && `print complexity: ${c.printComplexity}`,
    c.keepColors && `keep colors: ${c.keepColors}`,
    c.replaceColors && `replace colors: ${c.replaceColors}`,
    c.targetMood && `mood: ${c.targetMood}`,
    c.targetAudience && `audience: ${c.targetAudience}`,
    c.season && `season/holiday: ${c.season}`,
    c.dualShirt && `must read on both black & white shirts: ${c.dualShirt}`,
  ].filter(Boolean);
  return parts.length ? `${parts.join('; ')}.` : '';
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
    styleRetention: { emotion: '', texture: '', linework: '', colorMood: '', lettering: '', avoid: '' },
    risk: { sourceType: '', uniqueCompositionRisk: '', uniqueTextRisk: '', safeTransfer: '', mustReplace: '', targetSimilarity: '', strategy: '' },
    niches: [],
    hooks: [],
    paletteConstraints: { shirtColor: '', thumbnailContrast: '', printComplexity: '', keepColors: '', replaceColors: '', targetMood: '', targetAudience: '', season: '', dualShirt: '' },
    palettes: [],
    stickerCheck: { removeBg: '', clearOutline: '', singleFocal: '', canSimplify: '', transparentOk: '', readableThumbnail: '', canSeries: '' },
  };
}
