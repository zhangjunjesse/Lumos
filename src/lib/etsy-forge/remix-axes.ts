// 二创的零件库(对齐 playbook SOP):
//  1) RemixDirection —— 二创方向矩阵一条策略的内部形状("保留/改变"相似度策略)。
//     具体 A/B/C/D 数据 + 用户自定义已挪到 DB(remix-strategies.ts,设置里可增删改),不再写死。
//  2) HOOK_OPERATORS —— 创意钩子算子,让每张变体系统化拉差异。
//  3) TEXT_RULE_* —— 文字款规则(IP 规避在 remix-analyze.ts 的 buildRiskRule)。
// 生成时:对每个选中的方向 × 轮流取一个钩子,组装变体 prompt(注入 {direction} 和 {hook})。

export type RemixDirectionKey = string; // 方向编码(A/B/C/D 或用户自定义),动态

export interface RemixDirection {
  key: RemixDirectionKey;
  label: string; // 中文(UI + 素材描述)
  desc: string; // 一句话说明(UI 选项)
  profile: string; // 英文,注入 {direction}:这条方向的"保留什么/改变什么"
  useReference: boolean; // 贴近原图→喂参考图;发散→纯文字从简报生成
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
