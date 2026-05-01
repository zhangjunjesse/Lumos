/**
 * WeChat Provider — Inbound Item Parser
 *
 * 提取入站 item_list 里用户可见的文本：
 *   - text item 直接取
 *   - voice item 用 ASR 转写
 *   - ref_msg（引用回复）：拼成 `[引用: ...]\n<text>` 形式
 *   - image item：bodyFromItemList 不读取（图像走 attachments 通道，由 monitor
 *     单独下载），但 ref_msg 引用图片时仍会折叠成"[图片]"占位
 *
 * 复刻自 cc-connect/platform/weixin/parse.go (MIT)。
 */

import {
  MESSAGE_ITEM_IMAGE,
  MESSAGE_ITEM_TEXT,
  MESSAGE_ITEM_VOICE,
  type ImageItem,
  type MessageItem,
} from './client';
import { parseAesKey, parseAesKeyHex } from './cdn';

const MEDIA_ITEM_TYPES = new Set([2, 3, 4, 5]); // image / voice / file / video

/**
 * Material needed to download + decrypt one CDN media blob.
 * Returned by extractInboundImages (and future audio/file extractors).
 */
export interface CdnDownloadTask {
  encryptedQueryParam: string;
  aesKey: Buffer;
}

/**
 * Pick the AES key for an image_item: prefer the 32-char hex on `aeskey`
 * (cc-connect 的 imageDecryptMaterial 主路径), fall back to media.aes_key (base64).
 * Returns null when neither is usable.
 */
function imageAesKey(img: ImageItem): Buffer | null {
  const hex = (img.aeskey || '').trim();
  if (hex) {
    try { return parseAesKeyHex(hex); } catch { /* fall through */ }
  }
  const b64 = (img.media?.aes_key || '').trim();
  if (b64) {
    try { return parseAesKey(b64); } catch { /* fall through */ }
  }
  return null;
}

/**
 * Walk an inbound item_list and return one download task per usable image item.
 * Items missing encrypt_query_param or aes_key are silently skipped.
 */
export function extractInboundImages(items: MessageItem[] | undefined): CdnDownloadTask[] {
  if (!items || items.length === 0) return [];
  const out: CdnDownloadTask[] = [];
  for (const item of items) {
    if (item.type !== MESSAGE_ITEM_IMAGE) continue;
    const img = item.image_item;
    if (!img) continue;
    const enc = (img.media?.encrypt_query_param || '').trim();
    if (!enc) continue;
    const key = imageAesKey(img);
    if (!key) continue;
    out.push({ encryptedQueryParam: enc, aesKey: key });
  }
  return out;
}

export function bodyFromItemList(items: MessageItem[] | undefined): string {
  if (!items || items.length === 0) return '';
  for (const item of items) {
    if (item.type === MESSAGE_ITEM_TEXT && item.text_item) {
      const text = (item.text_item.text || '').trim();
      const ref = item.ref_msg;
      if (!ref || !ref.message_item) return text;
      if (ref.message_item.type && MEDIA_ITEM_TYPES.has(ref.message_item.type)) {
        return text;
      }
      const refBody = bodyFromItemList([ref.message_item]);
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (refBody) parts.push(refBody);
      if (parts.length === 0) return text;
      return `[引用: ${parts.join(' | ')}]\n${text}`;
    }
    if (item.type === MESSAGE_ITEM_VOICE && item.voice_item) {
      const t = (item.voice_item.text || '').trim();
      if (t) return t;
    }
  }
  return '';
}
