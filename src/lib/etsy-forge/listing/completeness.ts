// 产品开发 — 完整度门禁(§7)。必填缺一即不可转 ready；推荐项不阻断只提示(R4 如实)。

import type { ListingRow } from './types';

export interface CompletenessItem {
  key: string;
  label: string;
}
export interface Completeness {
  percent: number; // 已填必填 / 必填总数
  missing: CompletenessItem[]; // 必填缺项(阻断 ready)
  recommended: CompletenessItem[]; // 推荐缺项(不阻断)
  canMarkReady: boolean;
}

function hasMainPhoto(l: ListingRow): boolean {
  return (l.photos || []).some((p) => p.isMain || p.role === 'main');
}

// 必填项：缺一即不可转 ready。
const REQUIRED: { key: string; label: string; ok: (l: ListingRow) => boolean }[] = [
  { key: 'title', label: '标题', ok: (l) => l.title.trim().length > 0 },
  { key: 'description', label: '描述', ok: (l) => l.description.trim().length > 0 },
  { key: 'tags', label: '标签(≥1)', ok: (l) => (l.tags || []).length > 0 },
  { key: 'main_photo', label: '主图', ok: hasMainPhoto },
  { key: 'price', label: '价格 > 0', ok: (l) => l.price > 0 },
  { key: 'quantity', label: '库存 > 0', ok: (l) => l.quantity > 0 },
  { key: 'taxonomy', label: '类目', ok: (l) => (l.taxonomy_path || []).length > 0 },
  { key: 'who_made', label: 'Who made it', ok: (l) => !!l.listing_details?.whoMade },
  { key: 'what_is', label: 'What is it', ok: (l) => !!l.listing_details?.whatIs },
  { key: 'when_made', label: 'When made', ok: (l) => !!l.listing_details?.whenMade },
  { key: 'listing_type', label: '类型(实物/数字)', ok: (l) => !!l.listing_type },
];

// 推荐项：不阻断 ready，但清单里标「建议补全」。
const RECOMMENDED: { key: string; label: string; ok: (l: ListingRow) => boolean }[] = [
  { key: 'materials', label: '材料', ok: (l) => (l.materials || []).length > 0 },
  { key: 'variations', label: '变体(尺码/颜色)', ok: (l) => (l.variations?.properties || []).length > 0 },
  { key: 'processing', label: '加工时间', ok: (l) => !!l.shipping?.processingTime },
  { key: 'origin', label: '原产国', ok: (l) => !!l.shipping?.countryOfOrigin },
  { key: 'attributes', label: '类目属性', ok: (l) => Object.keys(l.attributes || {}).length > 0 },
];

export function computeCompleteness(l: ListingRow): Completeness {
  const missing = REQUIRED.filter((r) => !r.ok(l)).map(({ key, label }) => ({ key, label }));
  const recommended = RECOMMENDED.filter((r) => !r.ok(l)).map(({ key, label }) => ({ key, label }));
  const filled = REQUIRED.length - missing.length;
  return {
    percent: Math.round((filled / REQUIRED.length) * 100),
    missing,
    recommended,
    canMarkReady: missing.length === 0,
  };
}
