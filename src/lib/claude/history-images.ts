// Image re-attachment for the Claude Agent SDK fallback path.
//
// When SDK session resume is dropped (e.g. an on_demand MCP like image-reader
// loads for the first time and changes the tool signature), Lumos rebuilds the
// turn from DB history via buildPromptWithHistory(). That path flattens
// everything to text, which turned image tool_results into a truncated base64
// smear the model reads as "[Unsupported Image]". This module pulls the image
// blocks back out so the caller can re-attach them as real multimodal content.

import type { HistoryMessage } from './history-normalizer';
import { isVisionMediaType, type VisionMediaType } from './vision-media';

// 一次对话可能有几十次 read_image,全部回放会撑爆请求体和 token。只回放最近
// N 张(newest 优先),并受 base64 字节预算约束;其余由文本里的 [图片 …] 标记代替。
export const FALLBACK_HISTORY_MAX_IMAGES = 3;
export const FALLBACK_HISTORY_MAX_IMAGE_BYTES = 6 * 1024 * 1024;

// Anthropic 风格 image content block —— image-reader 的 tool_result 在 DB 里就以
// 这个形态序列化(source.data=base64, source.media_type=mime),提取后可原样注入。
export interface HistoryImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: VisionMediaType; data: string };
}

// Walk newest → oldest, collect at most maxImages image blocks within a byte
// budget, then return them chronological (oldest-first) so they read in order.
export function extractHistoryImages(
  history: HistoryMessage[] | undefined,
  maxImages: number = FALLBACK_HISTORY_MAX_IMAGES,
  maxBytes: number = FALLBACK_HISTORY_MAX_IMAGE_BYTES,
): HistoryImageBlock[] {
  if (!history || history.length === 0) return [];
  const collected: HistoryImageBlock[] = [];
  let usedBytes = 0;

  for (let i = history.length - 1; i >= 0 && collected.length < maxImages; i--) {
    const msg = history[i];
    if (msg.role !== 'assistant') continue;
    const raw = (msg.content || '').trim();
    if (!raw.startsWith('[')) continue;
    let blocks: unknown;
    try { blocks = JSON.parse(raw); } catch { continue; }
    if (!Array.isArray(blocks)) continue;

    for (const block of blocks) {
      if (collected.length >= maxImages) break;
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type !== 'tool_result') continue;
      for (const img of imagesFromToolResultContent(b.content)) {
        if (collected.length >= maxImages) break;
        if (usedBytes + img.source.data.length > maxBytes) continue;
        collected.push(img);
        usedBytes += img.source.data.length;
      }
    }
  }

  return collected.reverse();
}

// tool_result.content is either a serialized content-blocks string (how
// image-reader is stored in DB) or an already-parsed array. Return image
// blocks found within it.
function imagesFromToolResultContent(content: unknown): HistoryImageBlock[] {
  let arr: unknown = content;
  if (typeof content === 'string') {
    const text = content.trim();
    if (!text.startsWith('[')) return [];
    try { arr = JSON.parse(text); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const images: HistoryImageBlock[] = [];
  for (const block of arr) {
    if (!block || typeof block !== 'object') continue;
    const img = toHistoryImageBlock(block as Record<string, unknown>);
    if (img) images.push(img);
  }
  return images;
}

function toHistoryImageBlock(block: Record<string, unknown>): HistoryImageBlock | null {
  if (block.type !== 'image') return null;
  const source = block.source as Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object') return null;
  const data = typeof source.data === 'string' ? source.data : '';
  const mediaType = source.media_type;
  if (!data || !isVisionMediaType(mediaType)) return null;
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}
