// 五类提示词的内置默认 + 「生效提示词」解析。
// 用户在「设置 → 提示词管理」可为每类存多条、选一条设为生效(is_default)；
// 自动任务(抠印花/分析素材/抠姿势)统一经 getEffectivePrompt 取生效那条，没自定义时回退到这里的内置默认。
// 不 mock：所有指令都直接喂给图片服务商，效果如实呈现。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type PromptCategory, type PromptRow } from './types';

// 抠印花：从衣服照片"重绘"出干净的印花图案文件(无损抠图做不到,改成忠实高保真重画同款同风格)。
const CUTOUT = [
  'You are a print-design recreation specialist. The reference photos show a printed/embroidered design ON a t-shirt (often worn or wrinkled). Read the design from them and RE-RENDER it as ONE clean, flat, standalone print artwork file — as if you had the original print-ready art.',
  'This is a faithful re-creation, not a photo cut-out: render it crisply and at high detail, but keep it TRUE to the original.',
  'Faithfully reproduce ALL of these from the reference:',
  '- The complete design and every element (each character/letter, animal, flower, leaf, line, shape) with the SAME composition, layout and internal proportions — nothing added, nothing dropped.',
  '- The EXACT art style and texture: if it is a woodcut / hand-printed / distressed / broken-stroke / sketch / halftone look, recreate that grain, broken edges, hatching and the open negative space INSIDE shapes. Do NOT smooth it into flat solid silhouettes or clean vector shapes.',
  '- The exact colors and color count (e.g. a red + blue 2-color print stays red + blue), including faded/ink-press variation.',
  'Output:',
  '- ONLY the artwork. NO t-shirt, fabric, garment, collar, sleeves, wrinkles, folds, model, hands, hanger or background.',
  '- Flatten any curvature/perspective from the worn fabric into a clean, front-facing flat graphic.',
  '- Fully transparent background (PNG); pure white (#FFFFFF) only if transparency is unavailable.',
  '- Do NOT add any new element, text, watermark, drop shadow, or fabric/garment texture.',
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

// 产品合成：把印花 inpaint 到确定颜色的空白 T 上，T 恤颜色/款式绝不改，印花贴合布料。
const PRODUCT_MERGE = [
  'You are a t-shirt mockup compositor. You receive two reference images: (1) a blank t-shirt product photo, (2) a printed design/graphic.',
  'Print the design (2) onto the FRONT CHEST of the t-shirt (1): centered, natural print size, following the fabric surface so it warps slightly with the folds and looks truly printed-on (NOT a flat floating sticker).',
  'The design (2) may come on a white/solid background — treat that background as TRANSPARENT: print ONLY the actual graphic motif onto the shirt. NEVER print a white (or any solid) rectangle/box/panel behind the design; the shirt fabric must show through all around and between the graphic shapes.',
  'ABSOLUTE constraints — do not violate:',
  '- Keep the t-shirt EXACTLY as in reference (1): same COLOR (do not recolor or shift the shirt color at all), same style, neckline, sleeves, fabric, folds and background.',
  '- Change NOTHING except adding the printed design on the chest. No new objects, no text, no watermark, no relighting of the shirt.',
  '- Output the same t-shirt, now with the design printed on the chest, with NO background box around the print.',
].join('\n');

// 二创·拆解(vision)：看参考印花,输出 STRICT JSON —— type(图案/文字/组合) + layout(版式) + ip_risk(侵权元素) +
// 复刻级 brief(含 KEEP/FREE) + 5 个量身变体方向(各带 keepReference)。代码解析 JSON;失败时 runRemix 降级到固定变体轴。
const REMIX_ANALYZE = [
  'You are a t-shirt print-design analyst. Study the reference print and return STRICT JSON only — no prose, no markdown, no code fences. The reference may be an imperfect cut-out: describe the INTENDED clean artwork and IGNORE any fabric remnants, rough edges, or extraction artifacts. Shape:',
  '{',
  '  "type": "graphic" | "text" | "combo",  // graphic=artwork only, no words; text=words/slogan/typography only; combo=artwork + slogan together (most common)',
  '  "layout": "single-hero" | "pattern" | "typographic" | "badge",  // single-hero=one central subject; pattern=scattered/repeated motifs filling the space; typographic=text-driven layout; badge=circular crest/emblem lockup',
  '  "ip_risk": "",  // if the design shows a recognizable brand, licensed character, sports/team mark, or copyrighted wording, name it here; otherwise empty string',
  '  "brief": "Compact brief, ONE item per line, concrete and specific to THIS image (detailed enough to redraw it from text alone):',
  '    SUBJECT: main subject/character and what it is doing',
  '    MOTIFS: the specific elements present (e.g. wildflowers, moon & stars, cat, vines, sacred geometry)',
  '    MEDIUM: technique — flat vector / clean line art / watercolor / halftone retro / hand-drawn / embroidery look / digital painting',
  '    LINE_DETAIL: line weight, clean vs distressed, detail density (minimal vs intricate)',
  '    PALETTE: the 2-5 dominant colors (name them) + treatment (flat / gradient / faded-vintage / high-saturation)',
  '    COMPOSITION: how elements are arranged (centered hero / scattered mini-pattern / arched text / symmetrical / repeated)',
  "    TYPOGRAPHY: if there is text, the lettering character (serif / handwritten script / bold sans / vintage); else 'none'",
  '    MOOD_ERA: overall vibe / era (vintage 80s / minimalist / celestial dreamy / playful cartoon / boho)',
  "    THEME: one line — the theme + roughly who it's for (used only to choose variant directions; keep short)",
  '    KEEP: the core that makes this design what it is — must be preserved or it stops being this design',
  '    FREE: purely decorative elements safe to change a lot",',
  '  "directions": [ exactly 5 objects {"text": "<a tailored remix direction for THIS design that FITS its type and layout; changes ONE main thing; preserves KEEP; yields a sellable ORIGINAL variant>", "keepReference": true|false} ]',
  "    // Spread the 5 across different levers that SUIT this design (swap motif/subject · recolor · change medium/style · change composition · shift mood/era). For a text design use slogan-angle / font / layout levers, NOT 'recolor the illustration'. Never make all five recolors.",
  '    // keepReference=true if the variant stays visually close (recolor, restyle) so the reference image helps; false if it departs a lot (new motif, new composition) and should be redrawn fresh from the brief.',
  '}',
  'Be concrete and specific to this image; no generic answers. "directions" must be an array of exactly 5 objects.',
].join('\n');

// 二创·变体(生成模板)：占位 {brief} 简报 / {direction} 本次方向 / {title} 标题 / {textRule}(代码按 type 注入) / {ipRule}(代码按 ip_risk 注入)。
// 构图与颜色遵从简报(不再写死单主角/2-4色),让图案款/文字款/富色款都不被一刀切。
const REMIX_VARIANT = [
  'You are an Etsy print-design remixer creating ONE original variant inspired by a reference print.',
  '',
  'Reference design brief:',
  '{brief}',
  '',
  'Source product title: {title}',
  '',
  'Apply THIS specific remix direction:',
  '{direction}',
  '',
  "Keep the brief's KEEP items (core equity, theme, art style, target-audience feel) so it stays on-trend; freely change the FREE items. The result MUST be a clearly different, original design listable on its own.",
  'Use the reference image ONLY as a loose style/color guide — redraw from scratch; do NOT trace or reproduce its exact shapes, poses or layout; do NOT copy it pixel-for-pixel.',
  '',
  'Follow the brief, do NOT override it:',
  "- Keep the SAME KIND of composition/layout as the brief's COMPOSITION (if it is a scattered pattern, a badge/emblem, or a text layout, STAY that kind — do NOT force a single centered subject) unless the direction above explicitly changes it.",
  "- Keep roughly the same color complexity as the brief's PALETTE (do NOT flatten a rich/gradient/vintage palette down to a few flat colors) unless the direction changes it.",
  '- Keep the design\'s natural aspect ratio; do NOT crop the artwork to fit a square.',
  '',
  '{textRule}',
  '{ipRule}',
  '',
  'Print-ready requirements (hard):',
  '- ONLY the standalone print artwork — NO t-shirt, NO model, NO background scene, NO mockup.',
  '- Transparent background (PNG); pure white only if transparency is unavailable.',
  '- Clean, crisp edges; generous negative space; print-quality detail.',
  '- NO watermark, NO signature.',
].join('\n');

export const DEFAULT_PROMPTS: Record<PromptCategory, string> = {
  cutout: CUTOUT,
  scene: SCENE,
  model: MODEL,
  product: PRODUCT,
  pose: POSE,
  'product-merge': PRODUCT_MERGE,
  'remix-analyze': REMIX_ANALYZE,
  'remix-variant': REMIX_VARIANT,
};

export const PROMPT_CATEGORIES: PromptCategory[] = ['cutout', 'scene', 'model', 'product', 'pose', 'product-merge', 'remix-analyze', 'remix-variant'];

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
