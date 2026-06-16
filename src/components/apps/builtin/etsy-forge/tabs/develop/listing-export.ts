// 导出：把 listing 拍平成对齐 Etsy 表单的 JSON / 单行 CSV，方便手动粘贴上架。
import type { ListingRow } from '@/lib/etsy-forge/listing/types';

export function toEtsyObject(l: ListingRow): Record<string, unknown> {
  return {
    title: l.title,
    description: l.description,
    tags: l.tags,
    materials: l.materials,
    price: l.price,
    currency: l.currency,
    quantity: l.quantity,
    sku: l.sku,
    category: l.taxonomy_path.join(' > '),
    section: l.section,
    who_made: l.listing_details.whoMade,
    what_is: l.listing_details.whatIs,
    when_made: l.listing_details.whenMade,
    listing_type: l.listing_type,
    renewal: l.renewal,
    production_partner: l.production_partner,
    attributes: l.attributes,
    variations: l.variations,
    personalization: l.personalization,
    shipping: l.shipping,
    photos: l.photos.map((p) => ({ role: p.role, isMain: !!p.isMain, src: p.src })),
    video: l.video_src ?? '',
  };
}

function csvCell(v: unknown): string {
  const s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(l: ListingRow): string {
  const obj = toEtsyObject(l);
  const keys = Object.keys(obj);
  return `${keys.join(',')}\n${keys.map((k) => csvCell(obj[k])).join(',')}`;
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
