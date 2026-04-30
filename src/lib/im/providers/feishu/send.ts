/**
 * Feishu Provider — Outbound Send
 *
 * 把 OutboundMessage 转成飞书 API 调用。
 * M2 范围：text。card / image / file 走 capabilities.media，
 * 但 M2 仅暴露 text 链路保证"行为不变"。后续在新增 capability 时扩展。
 */

import type { OutboundMessage, SendResult } from '../../core/types';
import type { FeishuClient } from './client';

export async function sendOutbound(
  client: FeishuClient,
  message: OutboundMessage,
): Promise<SendResult> {
  if (!message.address.chatId) {
    return { ok: false, error: 'chatId required' };
  }

  if (message.attachments && message.attachments.length > 0) {
    // M2 范围内不实现媒体出站；保持与原 FeishuAdapter.send 行为对齐。
    // 后续扩展时引入 sendImage / sendFile。
    return { ok: false, error: 'attachments not yet supported by feishu provider' };
  }

  try {
    const result = await client.sendText(message.address.chatId, message.text);
    if (result.messageId) return { ok: true, messageId: result.messageId };
    return { ok: false, error: result.error || 'send failed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
  }
}
