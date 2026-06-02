// 二创质量闸门:出图后调 vision 便宜质检,判每张是否「能用」。揪白底框/多余文字/糊/带衣服模特等硬伤。
// 返回 good/weak + 原因,存到素材上供 UI 标记;质检本身失败不惩罚(按 good 放行 + 记原因),不阻断。

import type { FetchedImage } from './image-fetch';
import { visionChat } from './vision-chat';
import type { VisionEndpoint } from './vision-provider';

const QA_TIMEOUT_MS = 90_000;

export interface RemixQa {
  flag: 'good' | 'weak';
  note: string;
}

function buildQaPrompt(type: 'graphic' | 'text' | 'combo'): string {
  // 只有纯图案款才把"出现文字"算硬伤;文字款/组合款本来就该有字。
  const textClause = type === 'graphic' ? ' it contains any text/letters;' : '';
  return [
    'You are a QA checker for print-on-demand print artwork. Look at this generated print and return STRICT JSON only: {"ok": true|false, "issue": "<short reason if not ok, else empty>"}.',
    `Mark ok=false if ANY of these is true:${textClause} it shows a visible white or solid rectangular background box (i.e. background is NOT transparent); it looks messy, blurry, low-quality, distorted or cut off; it is NOT a clean standalone print (e.g. shows a t-shirt, a model, or a scene background).`,
    'Otherwise ok=true.',
  ].join(' ');
}

export async function judgeRemix(ep: VisionEndpoint, image: FetchedImage, type: 'graphic' | 'text' | 'combo'): Promise<RemixQa> {
  try {
    const content = await visionChat(ep, image, buildQaPrompt(type), 300, QA_TIMEOUT_MS);
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('QA 未返回 JSON');
    const j = JSON.parse(m[0]) as { ok?: boolean; issue?: string };
    return j.ok === false ? { flag: 'weak', note: String(j.issue ?? '质量存疑') } : { flag: 'good', note: '' };
  } catch (err) {
    // 质检本身挂了不惩罚:放行,记原因供排查。
    return { flag: 'good', note: `质检未执行:${err instanceof Error ? err.message : String(err)}` };
  }
}
