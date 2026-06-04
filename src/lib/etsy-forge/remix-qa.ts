// 二创质量闸门(严格对齐 playbook Step10 评分表):出图后调 vision 按 8 个维度 1-5 打分 + 侵权风险 ——
//   缩略图识别度 / 印花适配 / 原创改写 / niche 匹配 / 创意钩子清晰度 / 配色有效性 / 系列化潜力 / 视觉冲击力(+ip 安全)。
// 给总分 + 各维度分 + 一句话点评。合格线只看 5 项(缩略图/印花适配/原创/niche ≥4 且 ip 安全 ≥3),其余 4 维只展示不卡。
// 质检本身失败不惩罚(按 good 放行 + 记原因),不阻断。

import type { FetchedImage } from './image-fetch';
import { visionChat } from './vision-chat';
import type { VisionEndpoint } from './vision-provider';

const QA_TIMEOUT_MS = 90_000;
// 合格线严格对齐 playbook Step10:缩略图/印花适配/原创改写/niche 匹配 这 4 项必须 ≥4;侵权安全 ≥3(低或中低风险)。
const CORE_PASS = 4;
const IP_PASS = 3;

export interface RemixQa {
  flag: 'good' | 'weak';
  note: string;
  score?: number; // 总分(满 45 = 9 维 × 5)
  dims?: Record<string, number>; // 各维度 1-5
}

function buildQaPrompt(type: 'graphic' | 'text' | 'combo'): string {
  // 只有纯图案款才把"出现文字"算硬伤;文字/组合款本来就该有字。
  const textNote =
    type === 'graphic'
      ? 'This should be a GRAPHIC-only design: penalize print_fit hard if it contains text/letters.'
      : 'This design is expected to contain a slogan; do NOT penalize for having text.';
  return [
    'You are a senior Etsy print-on-demand QA reviewer. Score this generated t-shirt PRINT artwork on 8 dimensions, each an INTEGER 1-5 (5=excellent, 1=unusable).',
    'Dimensions:',
    '- thumbnail: 3-second thumbnail recognition — bold, readable, eye-catching at small size.',
    '- print_fit: it is a clean STANDALONE print — transparent/clean background, NO white/solid rectangular box, NO t-shirt/model/scene, crisp edges, print-ready.',
    '- originality: it reads as an ORIGINAL design — does NOT copy a specific source layout, pose, exact symbol combination or wording.',
    '- niche_fit: it clearly serves a buyable niche (identity / emotion / use-case / gift), commercially sellable.',
    '- hook_clarity: the creative hook (the selling idea) reads clearly in one glance.',
    '- palette_effectiveness: the colors are limited, cohesive, high-contrast enough for a shirt, support the mood.',
    '- series_potential: it could be extended into a 5-10 piece series (consistent style, swappable subject).',
    '- visual_impact: overall punch / appeal of the design.',
    '- ip_safe: free of recognizable brands, licensed characters, team marks or copyrighted wording (5=clearly safe, 1=clear infringement).',
    textNote,
    'Return STRICT JSON ONLY: {"thumbnail":n,"print_fit":n,"originality":n,"niche_fit":n,"hook_clarity":n,"palette_effectiveness":n,"series_potential":n,"visual_impact":n,"ip_safe":n,"note":"<one short sentence, the biggest issue or strength>"}',
  ].join('\n');
}

const DIM_KEYS = ['thumbnail', 'print_fit', 'originality', 'niche_fit', 'hook_clarity', 'palette_effectiveness', 'series_potential', 'visual_impact', 'ip_safe'] as const;
const MAX_SCORE = DIM_KEYS.length * 5;
const clampDim = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
};

export async function judgeRemix(ep: VisionEndpoint, image: FetchedImage, type: 'graphic' | 'text' | 'combo'): Promise<RemixQa> {
  try {
    const content = await visionChat(ep, image, buildQaPrompt(type), 500, QA_TIMEOUT_MS);
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('QA 未返回 JSON');
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const dims: Record<string, number> = {};
    for (const k of DIM_KEYS) dims[k] = clampDim(j[k]);
    const score = DIM_KEYS.reduce((s, k) => s + dims[k], 0);
    const baseNote = typeof j.note === 'string' ? j.note.trim() : '';
    // 合格线:4 个核心维度全 ≥4 且侵权安全 ≥3。其余 4 维只展示、不卡。任一核心不达标 → weak。
    const fail: string[] = ['thumbnail', 'print_fit', 'originality', 'niche_fit'].filter((k) => dims[k] < CORE_PASS);
    if (dims.ip_safe < IP_PASS) fail.push('ip_safe');
    const weak = fail.length > 0;
    const note = weak
      ? [`评分 ${score}/${MAX_SCORE}`, `未达标:${fail.join('/')}`, baseNote].filter(Boolean).join(' · ')
      : [`评分 ${score}/${MAX_SCORE}`, baseNote].filter(Boolean).join(' · ');
    return { flag: weak ? 'weak' : 'good', note, score, dims };
  } catch (err) {
    // 质检本身挂了不惩罚:放行,记原因供排查。
    return { flag: 'good', note: `质检未执行:${err instanceof Error ? err.message : String(err)}` };
  }
}
