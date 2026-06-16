// SOP 对齐:/Users/zhangjun/私藏/etsy/prompt_research/playbook/etsy_product_mockup_sop.md
// 铁律:印花=唯一真图参考(Image 1);模特/场景/姿势只进文字方向;印花随褶皱变形+受光;线色随衣深浅。
// 这里是 SOP §3 模板 + §4 颜色表 + 防克隆默认池。改 prompt/颜色只改这里。

export interface ShirtColor {
  name: string; // 代号(传参用)
  label: string; // 中文展示
  desc: string; // 进 prompt 的英文描述
  dark: boolean; // 深色→白线 / 浅色→深线
}

// §4 Comfort Colors 常用色。
export const SHIRT_COLORS: ShirtColor[] = [
  { name: 'Pepper', label: '深灰 Pepper', desc: 'dark slate-grey "Pepper"', dark: true },
  { name: 'Moss', label: '橄榄绿 Moss', desc: 'olive green "Moss"', dark: true },
  { name: 'Black', label: '黑 Black', desc: 'black', dark: true },
  { name: 'Yam', label: '橘 Yam', desc: 'burnt orange "Yam"', dark: true },
  { name: 'Ivory', label: '米白 Ivory', desc: 'ivory', dark: false },
  { name: 'White', label: '纯白 White', desc: 'white', dark: false },
];

// 整体风格(界面单选)。fragment 注入模特/场景图 prompt,决定调性。改/加风格只改这里。
export interface PhotoStyle {
  key: string;
  label: string;
  fragment: string;
}
export const PHOTO_STYLES: PhotoStyle[] = [
  { key: 'phone', label: '手机随拍(真实)', fragment: 'Make it look like a REAL casual iPhone photo: candid everyday user-generated snapshot, slightly imperfect framing, soft phone-camera rendering with mild grain — NOT glossy, NOT over-sharpened, NOT cinematic color-grading, no professional retouching or model-agency look.' },
  { key: 'studio', label: '专业棚拍(干净)', fragment: 'Clean professional product photography: soft even studio lighting, crisp and well composed, neutral seamless feel, e-commerce catalog quality.' },
  { key: 'vintage', label: '复古胶片', fragment: 'Retro 90s film-photo aesthetic: warm faded tones, soft grain, slightly washed colors, nostalgic vintage mood, as if shot on an old film camera.' },
  { key: 'outdoor', label: '户外生活感', fragment: 'Bright outdoor lifestyle photo: natural daylight, airy and fresh, candid real-life feel, like a casual photo taken outside.' },
  { key: 'cozy', label: '居家温馨', fragment: 'Cozy at-home lifestyle photo: warm soft indoor light, relaxed homey mood, intimate everyday feel.' },
  { key: 'minimal', label: '极简 Ins', fragment: 'Minimal Instagram aesthetic: clean neutral palette, lots of negative space, bright and airy, calm modern mood.' },
  { key: 'moody', label: '暗调氛围', fragment: 'Moody atmospheric photo: low-key dim lighting, deep shadows, warm rich tones, intimate cinematic-but-natural mood.' },
  { key: 'street', label: '街头潮酷', fragment: 'Urban street-style photo: candid on a city street, casual cool vibe, natural daylight, real-life energy.' },
];
export const DEFAULT_STYLE = 'phone';
export const styleFragment = (key?: string) => (PHOTO_STYLES.find((s) => s.key === key) ?? PHOTO_STYLES[0]).fragment;

const lineColor = (dark: boolean) => (dark ? 'WHITE' : 'DARK CHARCOAL');
const inv = (dark: boolean) => (dark ? ' (inverted to white because the shirt is dark)' : '');

// 铁律3:印花随褶皱变形 + 受光(防贴纸感)。
const REALISM = [
  'CRITICAL realism — the print must look truly PRINTED INTO the fabric, NOT a flat sticker:',
  '- print lines follow and DISTORT along every wrinkle and fold; where fabric creases, the lines bend, break and warp',
  '- print curves and stretches over the chest/body contour, not perfectly flat',
  '- print catches the SAME lighting: brighter on raised folds, faded/darker in shadowed creases, uneven ink opacity',
  '- fabric weave texture shows slightly through the ink, soft vintage screen-print feel',
  '- do NOT redraw or change the design, only deform it naturally with the cloth',
].join('\n');

// §3.1 模特上身图(modelPoseScene=读图得来的"人+姿势+场景"文字,每张不同→不克隆)。
export function modelShotPrompt(shirt: ShirtColor, modelPoseScene: string, style: string): string {
  return [
    `A photo of a woman wearing an oversized ${shirt.desc} Comfort Colors t-shirt, shown from chin down to mid-thigh, face cropped above the lips. ${modelPoseScene}. Light it to MATCH that scene's own lighting (brightness, warmth / color-temperature, time of day). Real skin texture; the t-shirt has natural deep wrinkles and body contour over the chest.`,
    '',
    `Take the EXACT line-art design from Image 1 and print it centered on the chest as thin ${lineColor(shirt.dark)} line-art${inv(shirt.dark)}.`,
    '',
    REALISM,
    '',
    `${style} No watermark, no text overlay.`,
  ].join('\n');
}

// §3.2 场景氛围图(无模特,印花T恤摆进场景)。
export function sceneShotPrompt(shirt: ShirtColor, sceneDesc: string, prop: string, style: string): string {
  const line = shirt.dark ? 'white' : 'dark';
  return `Using Image 1 as the print design, naturally place a folded ${shirt.desc} vintage washed t-shirt draped over ${prop}. On the t-shirt's visible chest area, show the EXACT line-art print from Image 1 (${line} line), following the fabric folds with soft vintage screen-print texture. Keep the ${sceneDesc} unchanged. ${style} No watermark, no extra text.`;
}

// §3.3 设计特写图。
export function detailShotPrompt(shirt: ShirtColor): string {
  return `A close-up macro detail product photo of a ${shirt.desc} vintage washed cotton t-shirt fabric, showing the EXACT line-art print from Image 1 printed on it. Focus on the print, showing realistic faded vintage screen-print texture, slight ink cracking, soft cotton weave, gentle natural light. Realistic, no watermark, no text.`;
}

// §2 ④ 平铺白底主图(缩略图担当)。
export function flatMainPrompt(shirt: ShirtColor): string {
  return [
    `A clean flat-lay product photo of a neatly laid-flat ${shirt.desc} Comfort Colors t-shirt on a pure white seamless background, front view, centered.`,
    `Print the EXACT line-art design from Image 1 on the chest as thin ${lineColor(shirt.dark)} line-art${inv(shirt.dark)}, following the fabric folds with soft vintage screen-print texture (truly printed in, not a flat sticker).`,
    'Realistic studio product shot, no model, no props, no watermark, no text.',
  ].join('\n');
}

// 防克隆默认池(铁律4):用户没给方向参考时,每张轮换不同的人/姿势/场景。
export const MODEL_ROSTER = [
  'young woman, long wavy blonde hair, relaxed candid vibe',
  'woman in her early 30s, dark shoulder-length hair, calm confident vibe',
  'young woman, light-brown messy bun, soft girl-next-door vibe',
  'woman, short auburn hair, easygoing minimalist vibe',
];
export const POSE_ROSTER = [
  'standing relaxed with one hand in pocket, full body',
  'sitting cross-legged holding a mug',
  'walking candid mid-stride, hand adjusting hair',
  'leaning against a wall, arms loosely crossed',
];
export const SCENE_ROSTER = [
  'a cozy bedroom with soft daylight from a window, casual at-home vibe',
  'an outdoor city street, bright daylight, candid street-style',
  'a sunlit living room with a couch and a few plants, everyday vibe',
  'an outdoor park or garden on a bright sunny day, fresh natural light',
];
export const SCENE_PROPS = ['a wooden stool with dried flowers', 'a rattan chair by a window', 'a linen bed with a knit throw'];

// 精修:对已生成的商品图按指令再编辑(img2img)。
export function refinePrompt(instruction: string): string {
  const ins = instruction.trim() || 'subtly improve lighting and clarity, keep composition';
  return `Edit the reference product photo as instructed. Keep it photorealistic and e-commerce ready, keep the printed design unchanged unless asked. Instruction: ${ins}. No watermark, no extra text.`;
}
