// SOP「一键出品」步骤定义。链顺序即数组顺序;每商品独立按此链跑(步间依赖前步成功)。
// ①采集详情 ②采集店铺(可选) ③评论分析 ④图片分类 ⑤抠印花 ⑥分析素材+抠姿势 ⑦二创 ⑧出产品图(终点)。
// optional 步失败只记录、不中断后续(出图不依赖它);见 engine.runChainFrom / productTerminal。

import type { SopStepKey } from '../types';

export interface SopStepDef {
  key: SopStepKey;
  order: number;
  label: string;
  hint: string;
  optional?: boolean; // 可选步:失败不断主链(店铺信息是参考,不是出图主线)
}

export const SOP_STEPS: SopStepDef[] = [
  { key: 'detail', order: 0, label: '采集详情', hint: '爬详情图 + 评论(已采则跳过)' },
  { key: 'shop', order: 1, label: '采集店铺', hint: '采商品对应店铺:头像/基本信息/装修/EHunt(失败不挡出图)', optional: true },
  { key: 'review', order: 2, label: '评论分析', hint: '客户画像 / 卖点 / 痛点 / 动机' },
  { key: 'classify', order: 3, label: '图片分类', hint: 'AI 给每张详情图打类型' },
  { key: 'cutout', order: 4, label: '抠印花', hint: '商品/产品图合出 1 个印花' },
  { key: 'assets', order: 5, label: '素材+姿势', hint: '默认停用(产品图改用固定模板);设置里可开' },
  { key: 'remix', order: 6, label: '团队出图', hint: '出图团队按创作简报自主设计 → N 张原创印花' },
  { key: 'mockup', order: 7, label: '出产品图', hint: '印花 × 启用的T恤模板,程序合成零token' },
];

// 可选步:失败不中断该商品后续链(供 engine 判定是否断链 / 是否算终态失败)。
export function isOptionalStep(key: SopStepKey): boolean {
  return SOP_STEPS.find((s) => s.key === key)?.optional === true;
}

export const SOP_ONE_CLICK = 'one-click';
