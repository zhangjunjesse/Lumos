/**
 * WeChat (QClaw) Provider — Outbound Send
 */

import type { OutboundMessage, SendResult } from '../../core/types';
import type { QClawClient } from './client';

export async function sendOutbound(
  client: QClawClient,
  message: OutboundMessage,
): Promise<SendResult> {
  if (!message.address.chatId) {
    return { ok: false, error: 'chatId required' };
  }

  if (message.attachments && message.attachments.length > 0) {
    return { ok: false, error: 'attachments not yet supported by wechat-qclaw provider' };
  }

  const result = await client.sendMessage({
    chatId: message.address.chatId,
    text: message.text,
    parseMode: message.parseMode,
  });

  if (!result.ok) return { ok: false, error: result.error || 'send failed' };
  return { ok: true, messageId: result.messageId };
}
