// 二创质量闸门(对齐 playbook Step10 评分):出图后调 vision 按 5 个维度 1-5 打分 ——
//   缩略图冲击 / 印花适配(干净独立印花,无白底框无衣服模特) / 原创改写(不抄原图布局符号) / niche 契合 / 侵权风险。
// 给总分 + 各维度分 + 一句话点评,任一维度 ≤2 或总分 < 合格线 判 weak。质检本身失败不惩罚(按 good 放行 + 记原因),不阻断。

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
  score?: number; // 总分(满 25)
  dims?: Record<string, number>; // 各维度 1-5
}

function buildQaPrompt(type: 'graphic' | 'text' | 'combo'): string {
  // 只有纯图案款才把"出现文字"算硬伤;文字/组合款本来就该有字。
  const textNote =
    type === 'graphic'
      ? 'This should be a GRAPHIC-only design: penalize print_fit hard if it contains text/letters.'
      : 'This design is expected to contain a slogan; do NOT penalize for having text.';
  return [
    'You are a senior Etsy print-on-demand QA reviewer. Score this generated t-shirt PRINT artwork on 5 dimensions, each an INTEGER 1-5 (5=excellent, 1=unusable).',
    'Dimensions:',
    '- thumbnail: 3-second thumbnail impact — bold, readable, eye-catching at small size.',
    '- print_fit: it is a clean STANDALONE print — transparent/clean background, NO white/solid rectangular box, NO t-shirt/model/scene, crisp edges, print-ready.',
    '- originality: it reads as an ORIGINAL design — does NOT copy a specific source layout, pose, exact symbol combination or wording.',
    '- niche_fit: it clearly serves a buyable niche (identity / emotion / use-case / gift), commercially sellable.',
    '- ip_safe: free of recognizable brands, licensed characters, team marks or copyrighted wording (5=clearly safe, 1=clear infringement).',
    textNote,
    'Return STRICT JSON ONLY: {"thumbnail":n,"print_fit":n,"originality":n,"niche_fit":n,"ip_safe":n,"note":"<one short sentence, the biggest issue or strength>"}',
  ].join('\n');
}

const DIM_KEYS = ['thumbnail', 'print_fit', 'originality', 'niche_fit', 'ip_safe'] as const;
const clampDim = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
};

export async function judgeRemix(ep: VisionEndpoint, image: FetchedImage, type: 'graphic' | 'text' | 'combo'): Promise<RemixQa> {
  try {
    const content = await visionChat(ep, image, buildQaPrompt(type), 400, QA_TIMEOUT_MS);
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('QA 未返回 JSON');
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const dims: Record<string, number> = {};
    for (const k of DIM_KEYS) dims[k] = clampDim(j[k]);
    const score = DIM_KEYS.reduce((s, k) => s + dims[k], 0);
    const baseNote = typeof j.note === 'string' ? j.note.trim() : '';
    // 合格线:4 个核心维度全 ≥4 且侵权安全 ≥3。任一不达标 → weak。
    const fail: string[] = ['thumbnail', 'print_fit', 'originality', 'niche_fit'].filter((k) => dims[k] < CORE_PASS);
    if (dims.ip_safe < IP_PASS) fail.push('ip_safe');
    const weak = fail.length > 0;
    const note = weak
      ? [`评分 ${score}/25`, `未达标:${fail.join('/')}`, baseNote].filter(Boolean).join(' · ')
      : [`评分 ${score}/25`, baseNote].filter(Boolean).join(' · ');
    return { flag: weak ? 'weak' : 'good', note, score, dims };
  } catch (err) {
    // 质检本身挂了不惩罚:放行,记原因供排查。
    return { flag: 'good', note: `质检未执行:${err instanceof Error ? err.message : String(err)}` };
  }
}
