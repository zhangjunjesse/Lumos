// SOP §2.5/§122:模特/场景/姿势"读图→提炼文字方向"(绝不喂像素)。读每张参考 → 一句方向描述。
// 没识图服务商或读图失败 → 返回空,resolveBatchGen 回退内置默认池(仍能出图,不硬失败)。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { loadImageAsBase64 } from '../image-fetch';
import { visionChat } from '../vision-chat';
import { resolveVisionEndpoint } from '../vision-provider';

const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 200;

function localPathFromSrc(src: string): string | undefined {
  if (!src.startsWith('/api/media/serve')) return undefined;
  try {
    return new URL(src, 'http://localhost').searchParams.get('path') || undefined;
  } catch {
    return undefined;
  }
}

async function describe(store: AppDataStore, src: string, instruction: string, maxTokens = MAX_TOKENS): Promise<string> {
  const ep = resolveVisionEndpoint(store);
  if (!ep.ok) return '';
  try {
    const img = await loadImageAsBase64({ localPath: localPathFromSrc(src), url: src });
    return (await visionChat(ep.ep, img, instruction, maxTokens, TIMEOUT_MS)).trim();
  } catch {
    return '';
  }
}

// 读一组参考图 → 方向描述数组(并行读,过滤空)。
async function describeAll(store: AppDataStore, refs: string[], instruction: string, maxTokens = MAX_TOKENS): Promise<string[]> {
  const results = await Promise.all(refs.map((r) => describe(store, r, instruction, maxTokens)));
  return results.filter((t) => !!t);
}

// 详细读(让选择真正生效)。模特不提五官(避免复刻真人),但发型/发色/身形/肤色/气质都要,够具体才看得出差别。
const MODEL_Q =
  'Look at this reference for a t-shirt lifestyle photo. Describe the MODEL in specific detail so a new but similar-looking model can be generated: gender, approximate age, hair (length, style, color), body build, skin tone, overall style/vibe. Do NOT describe exact facial identity. One detailed phrase, no preamble. Example: "woman in her late 20s, long wavy auburn hair, slim athletic build, warm tan skin, relaxed boho vibe".';
const SCENE_Q =
  'Look at this reference scene. Describe it in specific detail so a similar setting can be recreated: indoor or outdoor, the location/setting, key props/decor, the LIGHTING (brightness bright-vs-dim, warmth warm-vs-cool, direction, time of day), and overall mood. One detailed phrase, no preamble. Example: "sunny outdoor beach with sand dunes and sea grass, bright warm golden afternoon light, breezy summer mood".';
const POSE_Q =
  'Look at this reference. Describe the POSE and framing in detail (borrow the action, not the person): body orientation, what the hands/arms are doing, sitting/standing/walking, and camera framing (full body / half / close-up). One detailed phrase, no preamble. Example: "standing relaxed with weight on one hip, one hand tucked in a pocket, looking slightly away, three-quarter body shot".';
// 已采集/关注的真实商品图:整体读 FULL 氛围(场景+光+模特+姿势+构图+情绪),供 AI 照着出全新相似图(不抄像素)。
// 要读"全",别只抓人——否则会丢掉户外/光线/整体调性。
const PRODUCT_Q =
  'Look at this real t-shirt product photo. Describe it in RICH, COMPLETE detail so a brand-new similar photo can be recreated. Cover ALL of: (1) the SETTING/scene — indoor or outdoor, the location and background; (2) the LIGHTING — brightness, warmth/color-temperature, direction, time of day; (3) the model — gender, age, hair, build, overall vibe (NO facial identity); (4) the pose and camera framing; (5) the overall mood/energy. Be specific. 2-3 short sentences, no preamble. Example: "Outdoors in a sunny green forest with soft bokeh; bright warm dappled daylight, cheerful summer feel; young woman with voluminous curly hair, relaxed; standing, half-body, smiling; vibrant and lively."';

export const modelDescs = (store: AppDataStore, refs: string[]) => describeAll(store, refs, MODEL_Q, 300);
export const sceneDescs = (store: AppDataStore, refs: string[]) => describeAll(store, refs, SCENE_Q, 300);
export const poseDescs = (store: AppDataStore, refs: string[]) => describeAll(store, refs, POSE_Q, 300);
export const productDescs = (store: AppDataStore, refs: string[]) => describeAll(store, refs, PRODUCT_Q, 500);
