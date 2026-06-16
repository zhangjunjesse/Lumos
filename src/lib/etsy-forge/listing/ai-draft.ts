// 产品开发 — AI 文案草稿(R2 草稿优先)。看本产品自有主图(vision) + 已采同行关键词/评论情报(仅定位，
// 严禁照搬同行原文) → 生成 title/description/tags/materials 草稿。落 copy_draft，用户采用才写正式字段。
// 没主图 / 没识图服务商 / 解析失败都如实抛错，不 mock。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { loadImageAsBase64 } from '../image-fetch';
import { visionChat } from '../vision-chat';
import { resolveVisionEndpoint } from '../vision-provider';
import { COLLECTIONS, type ProductRow } from '../types';
import { LISTING_LIMITS, type CopyDraft, type ListingPhoto, type ListingRow } from './types';

const TIMEOUT_MS = 120_000;
const MAX_TOKENS = 1600;

const SYSTEM =
  '你是资深 Etsy listing 文案。看到的是卖家自己的产品图，请写原创、可直接上架的英文 listing。只输出 JSON，不要解释或代码块标记。';

function localPathFromSrc(src: string): string | undefined {
  if (!src.startsWith('/api/media/serve')) return undefined;
  try {
    return new URL(src, 'http://localhost').searchParams.get('path') || undefined;
  } catch {
    return undefined;
  }
}

function mainPhoto(l: ListingRow): ListingPhoto | null {
  const photos = l.photos || [];
  return photos.find((p) => p.isMain) || photos.find((p) => p.role === 'main') || photos[0] || null;
}

// 来源采集商品的选品情报：关键词 + 评论好评点/动机/客户画像。只用于关键词与定位。
function buildIntel(store: AppDataStore, userId: string, l: ListingRow): string {
  if (!l.source_product_id) return '';
  const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, l.source_product_id);
  if (!p || p.user_id !== userId) return '';
  const lines: string[] = [];
  if (p.keyword) lines.push(`目标关键词: ${p.keyword}`);
  const ra = p.review_analysis;
  if (ra?.pros?.length) lines.push(`买家好评点: ${ra.pros.map((t) => t.topic).join(', ')}`);
  if (ra?.motivations?.length) lines.push(`购买动机: ${ra.motivations.map((t) => t.topic).join(', ')}`);
  if (ra?.customerProfile?.who) lines.push(`客户画像: ${ra.customerProfile.who}`);
  return lines.join('\n');
}

function buildPrompt(intel: string, hint: string): string {
  return [
    '请为图中这件产品写 Etsy listing 文案（英文）。',
    intel ? `可参考的选品情报（仅用于关键词与定位，严禁照搬任何同行原文）：\n${intel}` : '',
    hint ? `卖家补充卖点：${hint}` : '',
    '输出严格 JSON（不要多余文本）：',
    '{',
    '  "title": "≤140 字符，含核心关键词，Etsy 风格",',
    '  "description": "多段，含卖点/材质/尺码提示/适用场景/发货说明，自然口语",',
    '  "tags": ["≤13 个，每个≤20 字符，长尾 SEO 短语，全小写"],',
    '  "materials": ["≤13 个面料/材质"]',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseDraft(text: string): CopyDraft {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 返回不是 JSON，无法解析');
  const j = JSON.parse(m[0]) as { title?: string; description?: string; tags?: unknown; materials?: unknown };
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
  return {
    title: String(j.title || '').slice(0, LISTING_LIMITS.TITLE),
    description: String(j.description || ''),
    tags: arr(j.tags).map((t) => t.slice(0, LISTING_LIMITS.TAG_LEN)).slice(0, LISTING_LIMITS.TAGS),
    materials: arr(j.materials).slice(0, LISTING_LIMITS.MATERIALS),
    generatedAt: new Date().toISOString(),
  };
}

export async function generateCopyDraft(
  store: AppDataStore,
  userId: string,
  listing: ListingRow,
  hint = '',
): Promise<CopyDraft> {
  const photo = mainPhoto(listing);
  if (!photo) throw new Error('先在「图片」子 tab 设一张主图，再生成文案。');

  const resolved = resolveVisionEndpoint(store);
  if (!resolved.ok) throw new Error(resolved.error);

  const image = await loadImageAsBase64({ localPath: localPathFromSrc(photo.src), url: photo.src });
  const text = await visionChat(
    resolved.ep,
    image,
    `${SYSTEM}\n\n${buildPrompt(buildIntel(store, userId, listing), hint)}`,
    MAX_TOKENS,
    TIMEOUT_MS,
  );
  return parseDraft(text);
}
