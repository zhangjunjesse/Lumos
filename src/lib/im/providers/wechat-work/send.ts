/**
 * WeChat Work Provider — Outbound Send
 *
 * 企业微信发消息时 receive 字段为 touser/toparty/totag。M5 范围只支持 touser
 * (发给个人，userid 用 chatId 字段承载)。
 */

import type { OutboundMessage, SendResult } from '../../core/types';
import type { WechatWorkClient } from './client';

export async function sendOutbound(
  client: WechatWorkClient,
  message: OutboundMessage,
): Promise<SendResult> {
  if (!message.address.chatId) {
    return { ok: false, error: 'chatId required (use userid as chatId)' };
  }
  if (message.attachments && message.attachments.length > 0) {
    return { ok: false, error: 'attachments not yet supported by wechat-work provider' };
  }

  const result = await client.sendText(message.address.chatId, message.text);
  if (result.error) return { ok: false, error: result.error };
  return { ok: true, messageId: result.messageId };
}
