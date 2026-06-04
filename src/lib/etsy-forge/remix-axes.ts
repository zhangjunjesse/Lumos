// 二创的零件库(对齐 playbook SOP):
//  1) REMIX_DIRECTIONS —— 二创方向矩阵 A/B/C/D(每个方向 = 一套"保留/改变"相似度策略)。可多选;默认 B。
//  2) HOOK_OPERATORS —— 创意钩子算子(放大/换主体/反差/场景迁移/符号重组/情绪转向/简化),让每张变体系统化拉差异。
//  3) TEXT_RULE_* —— 文字款规则(IP 规避已挪到 remix-analyze.ts 的 buildRiskRule,含完整风险表)。
// 生成时:对每个选中的方向 × 轮流取一个钩子,组装变体 prompt(注入 {direction} 和 {hook})。

export type RemixDirectionKey = 'A' | 'B' | 'C' | 'D';

export interface RemixDirection {
  key: RemixDirectionKey;
  label: string; // 中文(UI + 素材描述)
  desc: string; // 一句话说明(UI 选项)
  profile: string; // 英文,注入 {direction}:这条方向的"保留什么/改变什么"
  useReference: boolean; // A/B 贴近原图→喂参考图;C/D 发散→纯文字从简报生成
}

// profile 里同时写明 Step4 相似度拆分的目标档位(内容/构图/文案/符号/风格/情绪/配色气质/材质),让模型按目标改。
export const REMIX_DIRECTIONS: RemixDirection[] = [
  {
    key: 'A',
    label: '同风格低改',
    desc: '像同一系列、轻度改 —— 最贴近原图味道',
    profile:
      'Direction A (same-style light variation): Keep the SAME visual style, emotional tone, color mood, texture and subject family. Change only details, local arrangement, poses, spacing, some symbol combos and the text. Looks like the same series but a clearly different design.\nSimilarity targets — content: medium-low · composition: medium · text: low · unique-symbol-combo: low · style: high · emotion: high · color-mood: high · texture/linework: high.',
    useReference: true,
  },
  {
    key: 'B',
    label: '风格一致大改',
    desc: '同一种画法、画明显不同的内容 —— 默认',
    profile:
      'Direction B (same-style major change, DEFAULT): Preserve the visual LANGUAGE — line quality, color mood, texture, vibe level, illustration style and target audience. Substantially change motif/subject details, actions, composition logic, symbol arrangement, layout rhythm and text. Same aesthetic, clearly a different product.\nSimilarity targets — content: low/medium-low · composition: low/medium-low · text: low · unique-symbol-combo: low · style: medium-high · emotion: medium-high · color-mood: medium-high · texture/linework: medium-high.',
    useReference: true,
  },
  {
    key: 'C',
    label: '元素保留风格大改',
    desc: '保留题材卖点、换一套视觉系统 —— 爆款化/换风格',
    profile:
      'Direction C (keep concept, restyle): Use the reference ONLY for its core theme, core elements, buyer emotion and search intent. Reinterpret in a NEW visual style: new linework, new color system, new composition, new rendering. Do not keep the original look.\nSimilarity targets — content/theme: medium-high · composition: low · text: low · style: low · emotion: medium · color-mood: low · texture/linework: low.',
    useReference: false,
  },
  {
    key: 'D',
    label: '只保留商业语义',
    desc: '只借市场机会重做 —— 相似风险最低',
    profile:
      'Direction D (market-opportunity only): Use the reference ONLY to infer buyer type, emotional value, use case and search intent. Create a completely new design for the same buyer — new subject, style, composition, text, symbol system and palette. Max originality, min similarity.\nSimilarity targets — content: low · composition: low · text: low · style: low · emotion: medium · color-mood: low · texture/linework: low.',
    useReference: false,
  },
];

export function getDirection(key: string): RemixDirection {
  return REMIX_DIRECTIONS.find((d) => d.key === key) ?? REMIX_DIRECTIONS[1]; // 默认 B
}

export interface HookOperator {
  key: string;
  label: string; // 中文
  instruction: string; // 英文,注入 {hook}
}

// 创意钩子算子(文档 10 个,完整):每张变体应用一个,系统化制造差异(不靠固定梗)。
// 拆解阶段会按这张图产出"图像定制的候选钩子";这里是算子全集,作菜单 + 拆解没给时的兜底。
export const HOOK_OPERATORS: HookOperator[] = [
  { key: 'amplify', label: '放大卖点', instruction: 'Creative hook — Amplify: take the single strongest selling point of the reference and make it the dominant, exaggerated focus.' },
  { key: 'replace', label: '换主体/道具', instruction: 'Creative hook — Replace: swap the main subject, props, scene or text for a fresh but audience-fitting alternative.' },
  { key: 'contrast', label: '反差', instruction: 'Creative hook — Contrast: create a contrast across subject, behavior, tone or scene (e.g. a cute thing doing an unexpected opposite action).' },
  { key: 'mood-shift', label: '情绪转向', instruction: 'Creative hook — Mood shift: sweet→sarcastic, cute→slacker, vintage→modern-meme, dark→healing — keep the same buyer.' },
  { key: 'scene-shift', label: '场景迁移', instruction: 'Creative hook — Scene shift: daily → holiday, hobby → profession, single → group identity, static → action.' },
  { key: 'identity-bind', label: '身份绑定', instruction: 'Creative hook — Identity binding: bind the design to a purchasable identity (profession/role/community), but only one supported by the image facts and semantics.' },
  { key: 'recombine', label: '符号重组', instruction: 'Creative hook — Symbol recombination: keep the theme symbols but change their arrangement and visual structure.' },
  { key: 'style-transfer', label: '风格迁移', instruction: 'Creative hook — Style transfer: keep the emotion and color energy, switch the visual style language.' },
  { key: 'rewrite-copy', label: '文案重写', instruction: 'Creative hook — Copy rewrite: keep the tone/message, write an original new phrase (never reuse the original wording).' },
  { key: 'simplify', label: '简化印花', instruction: 'Creative hook — Simplify: remove busy background and secondary symbols so the main motif reads as a clean, bold t-shirt print.' },
];

// 按拆解 type 注入 {textRule}(图案款禁字 / 文字款原创标语 / 组合款图文都留)。
export const TEXT_RULE_GRAPHIC = 'This is a GRAPHIC design: the artwork has NO text or letters.';
export const TEXT_RULE_TEXT =
  'This is a TYPOGRAPHY/slogan design: the hero is an ORIGINAL short slogan in natural, idiomatic US English with the same vibe as the reference — do NOT reuse the reference exact wording. Strong, clean, well-composed lettering.';
export const TEXT_RULE_COMBO =
  'This is a graphic + slogan design: keep BOTH an illustration AND a short slogan, in the same image/text balance as the reference. Write an ORIGINAL slogan in natural, idiomatic US English (same vibe; do NOT copy the exact wording).';
