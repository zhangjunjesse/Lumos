// 提示词分类的 UI 展示列表(key → 中文 label)。与 lib/etsy-forge/prompt-defaults 的 PromptCategory 对齐。
// 抠印花 / 场景图 / 模特图 / 产品图 / 抠姿势 / 产品合成 / 二创。

export const PROMPT_CATS: { key: string; label: string }[] = [
  { key: 'cutout', label: '抠印花' },
  { key: 'scene', label: '场景图' },
  { key: 'model', label: '模特图' },
  { key: 'product', label: '产品图' },
  { key: 'pose', label: '抠姿势' },
  { key: 'product-merge', label: '产品合成' },
  { key: 'remix-analyze', label: '二创·拆解' },
  { key: 'remix-variant', label: '二创·变体' },
];
