// 二创·拆解(vision):调图片服务商 chat 端点看参考印花,产出 JSON —— 类型(图案/文字款)+ 设计简报(含 KEEP/FREE)+ 5 个量身变体方向。
// 本地印花用 base64 data URL 喂。解析 JSON;失败抛错,由 runRemix 决定降级(不 mock)。

import type { FetchedImage } from './image-fetch';
import { visionChat } from './vision-chat';
import type { VisionEndpoint } from './vision-provider';

const ANALYZE_TIMEOUT_MS = 90_000;

export interface RemixDirection {
  text: string;
  useReference: boolean; // true=贴近原图(喂参考图辅助) / false=发散(纯文字生成、更原创)
}

export type RemixType = 'graphic' | 'text' | 'combo';
export type RemixLayout = 'single-hero' | 'pattern' | 'typographic' | 'badge';

export interface RemixBrief {
  type: RemixType;
  layout: RemixLayout;
  ipRisk: string; // 侵权风险元素描述(空=无)
  brief: string;
  directions: RemixDirection[]; // 量身方向(可能 <5,runRemix 用固定轴补齐)
}

const TYPES: RemixType[] = ['graphic', 'text', 'combo'];
const LAYOUTS: RemixLayout[] = ['single-hero', 'pattern', 'typographic', 'badge'];

// 方向既兼容旧的纯字符串,也兼容 {text, keepReference} 对象。
function toDirection(d: unknown): RemixDirection | null {
  if (typeof d === 'string') return d.trim() ? { text: d.trim(), useReference: true } : null;
  if (d && typeof d === 'object') {
    const o = d as { text?: unknown; keepReference?: unknown };
    const text = String(o.text ?? '').trim();
    if (!text) return null;
    return { text, useReference: o.keepReference !== false };
  }
  return null;
}

function parseRemixJson(raw: string): RemixBrief {
  const m = raw.match(/\{[\s\S]*\}/); // 去掉可能的 code fence / 前后赘述,取第一个 JSON 对象
  if (!m) throw new Error('拆解未返回 JSON');
  const j = JSON.parse(m[0]) as { type?: string; layout?: string; ip_risk?: string; brief?: string; directions?: unknown };
  const directions = Array.isArray(j.directions)
    ? j.directions.map(toDirection).filter((d): d is RemixDirection => d !== null)
    : [];
  return {
    type: TYPES.includes(j.type as RemixType) ? (j.type as RemixType) : 'graphic',
    layout: LAYOUTS.includes(j.layout as RemixLayout) ? (j.layout as RemixLayout) : 'single-hero',
    ipRisk: String(j.ip_risk ?? '').trim(),
    brief: String(j.brief ?? '').trim(),
    directions,
  };
}

export async function analyzeForRemix(ep: VisionEndpoint, designImg: FetchedImage, prompt: string): Promise<RemixBrief> {
  const content = await visionChat(ep, designImg, prompt, 700, ANALYZE_TIMEOUT_MS);
  const parsed = parseRemixJson(content);
  if (!parsed.brief) throw new Error('拆解 JSON 缺 brief');
  return parsed;
}
