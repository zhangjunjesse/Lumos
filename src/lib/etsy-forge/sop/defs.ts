// SOP「一键出品」步骤定义。链顺序即数组顺序;每商品独立按此链跑(步间依赖前步成功)。
// ①采集详情 ②a评论分析 ②b图片分类 ③抠印花 ④分析素材+抠姿势 ⑤二创 ⑥出产品图(终点)。

import type { SopStepKey } from '../types';

export interface SopStepDef {
  key: SopStepKey;
  order: number;
  label: string;
  hint: string;
}

export const SOP_STEPS: SopStepDef[] = [
  { key: 'detail', order: 0, label: '采集详情', hint: '爬详情图 + 评论(已采则跳过)' },
  { key: 'review', order: 1, label: '评论分析', hint: '客户画像 / 卖点 / 痛点 / 动机' },
  { key: 'classify', order: 2, label: '图片分类', hint: 'AI 给每张详情图打类型' },
  { key: 'cutout', order: 3, label: '抠印花', hint: '商品/产品图合出 1 个印花' },
  { key: 'assets', order: 4, label: '素材+姿势', hint: '场景/模特/产品(空白T)/姿势' },
  { key: 'remix', order: 5, label: '二创', hint: '印花×标题/卖点 → 5 个变体' },
  { key: 'mockup', order: 6, label: '出产品图', hint: '5 个二创印花 × 空白T → 5 个产品图' },
];

export const SOP_ONE_CLICK = 'one-click';
