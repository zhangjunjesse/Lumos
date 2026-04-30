/**
 * WeChat Provider — Inbound Item Parser
 *
 * 提取入站 item_list 里用户可见的文本：
 *   - text item 直接取
 *   - voice item 用 ASR 转写
 *   - ref_msg（引用回复）：拼成 `[引用: ...]\n<text>` 形式
 *   - 媒体（图片/文件/视频）：M+1 范围，目前返回空字符串
 *
 * 复刻自 cc-connect/platform/weixin/parse.go (MIT)。
 */

import { MESSAGE_ITEM_TEXT, MESSAGE_ITEM_VOICE, type MessageItem } from './client';

const MEDIA_ITEM_TYPES = new Set([2, 3, 4, 5]); // image / voice / file / video

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
