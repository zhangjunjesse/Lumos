// 产品开发 — Etsy 取值集 / 字段目录(§6 设计真源的落地)。纯数据，lib 与组件共享。
// 改取值集只改这里。POD 服饰为内置默认；类目变化时类目属性随之。

import type { PhotoRole, WhoMade, WhatIs } from './types';

// 图位角色：顺序即 Etsy 图片排序建议；hint 指明从哪类自有图源挑。
export const PHOTO_ROLES: { role: PhotoRole; label: string; hint: string }[] = [
  { role: 'main', label: '主图', hint: '缩略图/搜索结果图，挑最抓眼的(高分产品图)' },
  { role: 'model', label: '模特图', hint: '上身/真人穿着场景' },
  { role: 'scene', label: '场景图', hint: '生活场景/氛围图' },
  { role: 'flatlay', label: '平铺图', hint: '产品平铺，只看产品本身' },
  { role: 'detail', label: '细节图', hint: '印花/面料/工艺特写' },
  { role: 'size_chart', label: '尺码图', hint: '尺码表(上传或自有)' },
  { role: 'color', label: '颜色图', hint: '各颜色/变体展示' },
  { role: 'packaging', label: '包装图', hint: '包装/赠品(上传)' },
  { role: 'extra1', label: '备用 1', hint: '任意自有图' },
  { role: 'extra2', label: '备用 2', hint: '任意自有图' },
];

export const WHO_MADE: { value: WhoMade; label: string }[] = [
  { value: 'i_did', label: '我本人制作' },
  { value: 'someone_else', label: '他人/生产合作方(POD)' },
  { value: 'collective', label: '团队/集体' },
];

export const WHAT_IS: { value: WhatIs; label: string }[] = [
  { value: 'finished_product', label: '成品' },
  { value: 'supply', label: '原料/工具' },
];

// Etsy「何时制作」取值(常用集；POD 通常 made_to_order)。
export const WHEN_MADE: { value: string; label: string }[] = [
  { value: 'made_to_order', label: '按需制作(Made to order)' },
  { value: '2020_2025', label: '2020-2025' },
  { value: '2010_2019', label: '2010-2019' },
  { value: '2006_2009', label: '2006-2009' },
  { value: 'before_2006', label: '2006 年前' },
  { value: 'vintage', label: 'Vintage(20 年以上)' },
];

export const LISTING_TYPE_OPTS = [
  { value: 'physical', label: '实物' },
  { value: 'digital', label: '数字商品' },
] as const;

export const RENEWAL_OPTS = [
  { value: 'automatic', label: '自动续期' },
  { value: 'manual', label: '手动续期' },
] as const;

// POD 服饰常用类目树(可手填自定义)。值即 taxonomy_path。
export const TAXONOMY_PRESETS: { label: string; path: string[] }[] = [
  { label: 'T恤(成人 Unisex)', path: ['Clothing', 'Unisex Adult Clothing', 'Tops & Tees', 'T-shirts'] },
  { label: '卫衣/连帽衫', path: ['Clothing', 'Unisex Adult Clothing', 'Hoodies & Sweatshirts'] },
  { label: '女装 T恤', path: ["Clothing", "Women's Clothing", 'Tops & Tees', 'T-shirts'] },
  { label: '男装 T恤', path: ["Clothing", "Men's Clothing", 'Tops & Tees', 'T-shirts'] },
  { label: '童装 T恤', path: ['Clothing', "Children's Clothing", 'Tops & Tees'] },
  { label: '马克杯', path: ['Home & Living', 'Kitchen & Dining', 'Drink & Barware', 'Mugs'] },
  { label: '帆布袋(Tote)', path: ['Bags & Purses', 'Totes'] },
  { label: '贴纸 Sticker', path: ['Paper & Party Supplies', 'Paper', 'Stickers, Labels & Tags', 'Stickers'] },
  { label: '海报 Poster', path: ['Art & Collectibles', 'Prints', 'Digital Prints'] },
];

// 尺码/颜色预设(变体常用)。
export const SIZE_PRESET = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
export const COLOR_PRESET = ['Black', 'White', 'Navy', 'Gray', 'Sand', 'Red', 'Forest Green', 'Pink'];

// 类目属性目录：按类目根(taxonomy_path[0])给一组属性。服饰(Clothing)内置全套。
export interface AttributeDef {
  key: string;
  label: string;
  options?: string[]; // 有 options=下拉；无=自由文本
}

const APPAREL_ATTRIBUTES: AttributeDef[] = [
  { key: 'primary_color', label: '主色', options: ['Black', 'White', 'Blue', 'Red', 'Green', 'Pink', 'Gray', 'Beige', 'Yellow', 'Purple', 'Orange', 'Brown'] },
  { key: 'secondary_color', label: '辅色', options: ['None', 'Black', 'White', 'Blue', 'Red', 'Green', 'Pink', 'Gray', 'Beige', 'Yellow'] },
  { key: 'garment_style', label: '款式', options: ['Crew neck', 'V-neck', 'Tank', 'Long sleeve', 'Hoodie', 'Sweatshirt', 'Oversized'] },
  { key: 'neckline', label: '领型', options: ['Crew', 'V-neck', 'Scoop', 'Hooded'] },
  { key: 'sleeve_length', label: '袖长', options: ['Short sleeve', 'Long sleeve', 'Sleeveless', '3/4 sleeve'] },
  { key: 'fit', label: '版型', options: ['Regular', 'Slim', 'Oversized', 'Relaxed'] },
  { key: 'size_scale', label: '尺码标准', options: ['US', 'EU', 'UK', 'Asian'] },
  { key: 'occasion', label: '场合', options: ['Everyday', 'Birthday', 'Wedding', 'Party', 'Gift'] },
  { key: 'holiday', label: '节日', options: ['None', 'Christmas', 'Halloween', "Valentine's Day", "Mother's Day", "Father's Day", 'Thanksgiving'] },
];

const GENERIC_ATTRIBUTES: AttributeDef[] = [
  { key: 'primary_color', label: '主色' },
  { key: 'occasion', label: '场合' },
  { key: 'holiday', label: '节日' },
];

// 按类目根返回该类目的属性目录。
export function attributesForTaxonomy(path: string[]): AttributeDef[] {
  const root = (path[0] || '').toLowerCase();
  if (root === 'clothing') return APPAREL_ATTRIBUTES;
  return GENERIC_ATTRIBUTES;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  developing: '开发中',
  ready: '待上架',
  listed: '已上架',
  archived: '归档',
};
