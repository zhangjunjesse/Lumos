// 五类提示词的内置默认 + 「生效提示词」解析。
// 用户在「设置 → 提示词管理」可为每类存多条、选一条设为生效(is_default)；
// 自动任务(抠印花/分析素材/抠姿势)统一经 getEffectivePrompt 取生效那条，没自定义时回退到这里的内置默认。
// 不 mock：所有指令都直接喂给图片服务商，效果如实呈现。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type PromptCategory, type PromptRow } from './types';

// 抠印花：从 T 恤照片里提取印花/刺绣图案本身，丢掉 T 恤和背景。
const CUTOUT = [
  'You are a graphic-extraction specialist for apparel. From the provided T-shirt photos, extract ONLY the printed/embroidered DESIGN (the graphic artwork) that sits on the shirt — NOT the shirt itself. Use ALL images only as references to read the artwork clearly.',
  'Output:',
  '- ONLY the design/artwork itself. Do NOT include the T-shirt, fabric, garment, collar, sleeves, wrinkles, folds, model, hands, hanger, or background.',
  '- Place the isolated artwork on a fully transparent background (PNG); use pure white (#FFFFFF) only if transparency is unavailable.',
  '- If the design sits on curved or wrinkled fabric, flatten and straighten it into a clean, front-facing flat graphic.',
  'Preserve exactly — do not simplify, re-draw, smooth, recolor, or add anything:',
  '- The complete design: every flower, leaf, line, letter, shape and color of the print/embroidery, with exact colors, color layering and gradients.',
  '- Embroidery stitch texture / print texture and fine detail at original resolution.',
  '- The full artwork with nothing cropped; keep its internal proportions and layout.',
  '- Do NOT add any new element, text, watermark, drop shadow, or fabric/garment texture — output just the clean isolated artwork.',
].join('\n');

// 场景图：读懂爆款原图场景的"门道"再生成一个空场景(去人去产品),把优点沿用过来。
const SCENE = [
  'You are a product-photography art director. The reference photos are best-selling listing images. Study WHY their setting works, then generate ONE clean background scene/environment that reuses those strengths.',
  'First analyze and then RECREATE these qualities from the references:',
  '- Prop & object selection (what items decorate the scene: plants, furniture, fabrics, tableware, seasonal decor…) and keep equivalent tasteful props.',
  '- Composition & placement: how objects are arranged, depth, foreground/background layering, negative space left for a product.',
  '- Color palette & coordination: the overall color harmony, accent colors, warm/cool balance.',
  '- Decorative details and styling that make it feel premium.',
  '- Lighting & mood: direction, softness, time-of-day feeling, shadows.',
  'Output requirements:',
  '- Generate ONLY the scene/environment. There must be NO people and NO product/garment in it — leave a natural empty spot where a product would later be placed.',
  '- Photorealistic, high quality, well-lit, usable as a real product-photography backdrop.',
  '- Do NOT add text, watermark, logos, or any product.',
].join('\n');

// 模特图：生成一个穿空白(无印花)T 恤的真实模特,正面站姿,干净影棚背景。
const MODEL = [
  "You are a fashion-photography director. Using the reference photos to match the model's look (gender, approximate age, skin tone, hair, body build) and the listing's vibe,",
  'generate a full-body photorealistic photo of ONE model wearing a completely PLAIN, UNBRANDED, BLANK t-shirt — no print, no graphic, no logo, no text on the shirt.',
  'Pose: natural front-facing standing pose, full body visible. Background: clean, plain, softly-lit studio backdrop.',
  'Photorealistic, flattering studio lighting, sharp focus. Do NOT add any print on the shirt, text, or watermark.',
].join('\n');

// 产品图：把原图里的 T 恤变成完全空白的载体,纯白底,正面平铺/正视。
const PRODUCT = [
  'You are a product-mockup specialist. Using the reference photos, generate the SAME style of t-shirt/garment but completely BLANK.',
  'Remove ALL prints, graphics, logos, embroidery and text from the garment — keep only the plain fabric in its original color.',
  'Front view, centered, on a pure white (#FFFFFF) seamless background. Photorealistic product mockup with natural fabric folds and soft shadow.',
  'Do NOT add any design, text, or watermark — output a clean blank-garment carrier.',
].join('\n');

// 抠模特姿势：从一张含模特的原图,抠出模特本人(去背景),保留真实姿势和身上的衣服(不改衣服)。
const POSE = [
  'You are a photo-cutout specialist. From the provided photo, extract ONLY the person/model (the human), keeping their exact real pose, body, hands, hair and the clothing they are wearing — do NOT change, redraw, restyle, or recolor the garment or the print on it.',
  'Output:',
  '- ONLY the cut-out model with their original pose and clothing preserved exactly.',
  '- Remove the entire background (scene, props, furniture, floor, other people). Place the model on a fully transparent background (PNG); use pure white (#FFFFFF) only if transparency is unavailable.',
  '- Keep the model complete and uncropped, at original resolution and proportions.',
  '- Do NOT add text, watermark, shadow, or any new element. If the photo contains no person, return nothing usable.',
].join('\n');

export const DEFAULT_PROMPTS: Record<PromptCategory, string> = {
  cutout: CUTOUT,
  scene: SCENE,
  model: MODEL,
  product: PRODUCT,
  pose: POSE,
};

export const PROMPT_CATEGORIES: PromptCategory[] = ['cutout', 'scene', 'model', 'product', 'pose'];

// 取某分类「当前生效」的提示词内容：用户标记的 is_default 那条 → 否则该类第一条 → 否则内置默认。
export function getEffectivePrompt(store: AppDataStore, userId: string, category: PromptCategory): string {
  const rows = store.query<PromptRow>(COLLECTIONS.PROMPTS, {
    filter: { user_id: userId, category },
    orderBy: { field: 'created_at', direction: 'asc' },
    limit: 500,
  });
  const chosen = rows.find((r) => r.is_default) ?? rows[0];
  const content = chosen?.content?.trim();
  return content || DEFAULT_PROMPTS[category];
}
