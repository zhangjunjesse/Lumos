// 二创·变体的构件:
//  1) REMIX_AXES —— 通用「受控变体轴」,仅作**降级兜底**:拆解阶段没给出量身方向(或解析失败)时用它们;每条改一处。
//  2) TEXT_RULE_* —— 文字款规则,按拆解出的 type 注入「二创·变体」模板的 {textRule}。

// 按拆解的 type 注入「二创·变体」模板的 {textRule}(图案款禁字 / 文字款换原创标语 / 组合款图文都留)。
export const TEXT_RULE_GRAPHIC = 'This is a GRAPHIC design: the artwork has NO text or letters.';
export const TEXT_RULE_TEXT =
  'This is a TYPOGRAPHY/slogan design: the hero is an ORIGINAL short slogan in natural, idiomatic US English with the same vibe and message as the reference — do NOT reuse the reference exact wording. Strong, clean, well-composed lettering.';
export const TEXT_RULE_COMBO =
  'This is a graphic + slogan design: keep BOTH an illustration AND a short slogan, in the same image/text balance as the reference. Write an ORIGINAL slogan in natural, idiomatic US English (same vibe; do NOT copy the exact wording).';

// 按拆解的 ip_risk 注入 {ipRule}:空=不加;非空=明确不复刻该受保护元素。
export function buildIpRule(ipRisk: string): string {
  const r = ipRisk.trim();
  if (!r) return '';
  return `Do NOT reproduce this protected element from the reference: ${r}. Replace it with an original, non-infringing element that serves the same role.`;
}

export interface RemixAxis {
  key: string;
  label: string; // 中文,记到 asset 描述里便于辨认
  instruction: string; // 英文,喂给图片模型
  useReference: boolean; // 贴近原图的喂参考图;发散的纯文字生成(更原创、5 张差异更大)
}

export const REMIX_AXES: RemixAxis[] = [
  {
    key: 'recolor',
    label: '换配色',
    instruction:
      'Recolor scheme: keep the composition and subject, but apply a fresh, cohesive new color palette with a clearly different mood than the reference.',
    useReference: true,
  },
  {
    key: 'recompose',
    label: '换构图',
    instruction:
      'Recompose the layout: rearrange the elements into a different composition — e.g. turn a single centered hero into a balanced scattered mini-pattern, or vice versa; change orientation/placement.',
    useReference: false,
  },
  {
    key: 'restyle',
    label: '改繁简',
    instruction:
      'Change the rendering density: produce a cleaner, more minimal line-art interpretation of the same theme; or, if the reference is already minimal, a richer, more detailed version. Same theme and audience.',
    useReference: true,
  },
  {
    key: 'cross-niche',
    label: '跨场景',
    instruction:
      'Cross-niche twist: blend the theme with ONE adjacent interest or occasion that fits the same audience (e.g. coffee, books, plants, a seasonal holiday), adding a small relevant element while keeping the core subject dominant.',
    useReference: false,
  },
  {
    key: 'mood',
    label: '换基调',
    instruction:
      'Shift the mood: reinterpret the same subject in a different emotional tone (e.g. playful, vintage-distressed, dreamy/celestial) while keeping the same target audience.',
    useReference: true,
  },
];
