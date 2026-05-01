/**
 * WeChat Provider — Outbound Send
 *
 * 微信 ilink 协议要求发消息时携带 context_token——上一条入站消息里附带的 token，
 * 由 monitor 持久化。这里通过 lookup 拿到对应 peer 的最新 token；如果没有就拒绝
 * （bot 不能主动开启对话，必须先有用户消息进来才能回）。
 *
 * 长文本切片：单条 ilink 消息上限约 4000 字符，超过分段发送。
 *
 * 图片附件：lumos AI 生成或转发图片时通过 OutboundMessage.attachments 传入；
 * 这里识别 image/* 类型，走 client.sendImage 上传 + 发送。文本消息可与图片
 * 同时发，图片先发，再发文本。
 */

import fs from 'node:fs';
import type { IMFileAttachment, OutboundMessage, SendResult } from '../../core/types';
import { WechatClient, ERR_SESSION_EXPIRED, newClientId } from './client';

const MAX_CHUNK = 3800; // stay under ilink ~4000 char cap

interface SendDeps {
  /** Lookup the latest context_token for a peer userId. */
  getContextToken: (peer: string) => string;
}

export async function sendOutbound(
  client: WechatClient,
  message: OutboundMessage,
  deps: SendDeps,
): Promise<SendResult> {
  const peer = message.address.chatId.trim();
  if (!peer) return { ok: false, error: 'chatId (peer userId) required' };

  let contextToken = deps.getContextToken(peer);
  if (!contextToken) {
    return {
      ok: false,
      error:
        'No context_token for this peer yet. WeChat ilink requires an inbound message ' +
        'first; the bot cannot initiate.',
    };
  }

  const text = message.text.trim();
  const imageAttachments = (message.attachments || []).filter((a) =>
    (a.type || '').toLowerCase().startsWith('image/'),
  );
  const fileAttachments = (message.attachments || []).filter((a) =>
    !(a.type || '').toLowerCase().startsWith('image/'),
  );

  if (!text && imageAttachments.length === 0 && fileAttachments.length === 0) {
    return { ok: false, error: 'empty message' };
  }

  let lastMessageId: string | undefined;

  // 顺序：图片 → 文件 → 文本（与微信原生体验一致：媒体先到，文字说明在后）
  for (const attachment of imageAttachments) {
    const bytes = readAttachmentBytes(attachment);
    if (!bytes) {
      return { ok: false, error: `attachment "${attachment.name}" has no readable bytes` };
    }
    const result = await sendImageWithRetry(client, peer, bytes, contextToken);
    if (!result.ok) return { ok: false, error: result.error };
    lastMessageId = result.clientId;
    contextToken = deps.getContextToken(peer) || contextToken;
  }

  for (const attachment of fileAttachments) {
    const bytes = readAttachmentBytes(attachment);
    if (!bytes) {
      return { ok: false, error: `attachment "${attachment.name}" has no readable bytes` };
    }
    const result = await sendFileWithRetry(client, peer, bytes, attachment.name, contextToken);
    if (!result.ok) return { ok: false, error: result.error };
    lastMessageId = result.clientId;
    contextToken = deps.getContextToken(peer) || contextToken;
  }

  if (text) {
    const chunks = splitText(text, MAX_CHUNK);
    for (const chunk of chunks) {
      const result = await sendOneWithRetry(client, peer, chunk, contextToken);
      if (!result.ok) return { ok: false, error: result.error };
      lastMessageId = result.clientId;
      contextToken = deps.getContextToken(peer) || contextToken;
    }
  }

  return { ok: true, messageId: lastMessageId };
}

function readAttachmentBytes(attachment: IMFileAttachment): Buffer | null {
  if (attachment.data) {
    try { return Buffer.from(attachment.data, 'base64'); } catch { /* fall through */ }
  }
  if (attachment.filePath) {
    try { return fs.readFileSync(attachment.filePath); } catch { /* fall through */ }
  }
  return null;
}

async function sendImageWithRetry(
  client: WechatClient,
  peer: string,
  bytes: Buffer,
  contextToken: string,
): Promise<SendOneResult> {
  const clientId = newClientId();
  const first = await client.sendImage({ toUserId: peer, bytes, contextToken, clientId });
  if (first.ok) return { ok: true, clientId };

  if (first.ret === -2 || first.ret === ERR_SESSION_EXPIRED) {
    await delay(500);
    const second = await client.sendImage({ toUserId: peer, bytes, contextToken, clientId });
    if (second.ok) return { ok: true, clientId };
    return { ok: false, error: second.error || `sendImage failed (retry): ret=${second.ret}` };
  }

  return { ok: false, error: first.error || `sendImage failed: ret=${first.ret}` };
}

async function sendFileWithRetry(
  client: WechatClient,
  peer: string,
  bytes: Buffer,
  fileName: string,
  contextToken: string,
): Promise<SendOneResult> {
  const clientId = newClientId();
  const first = await client.sendFile({ toUserId: peer, bytes, fileName, contextToken, clientId });
  if (first.ok) return { ok: true, clientId };

  if (first.ret === -2 || first.ret === ERR_SESSION_EXPIRED) {
    await delay(500);
    const second = await client.sendFile({ toUserId: peer, bytes, fileName, contextToken, clientId });
    if (second.ok) return { ok: true, clientId };
    return { ok: false, error: second.error || `sendFile failed (retry): ret=${second.ret}` };
  }

  return { ok: false, error: first.error || `sendFile failed: ret=${first.ret}` };
}

interface SendOneResult {
  ok: boolean;
  error?: string;
  clientId?: string;
}

async function sendOneWithRetry(
  client: WechatClient,
  peer: string,
  text: string,
  contextToken: string,
): Promise<SendOneResult> {
  const clientId = newClientId();
  const first = await client.sendText({ toUserId: peer, text, contextToken, clientId });
  if (first.ok) return { ok: true, clientId };

  // ret=-2 means context_token stale; retry once with anything we have.
  // (Caller refreshes token from store between chunks; here we just retry the same payload
  // since this single call already used the freshest token we had.)
  if (first.ret === -2 || first.ret === ERR_SESSION_EXPIRED) {
    await delay(500);
    const second = await client.sendText({ toUserId: peer, text, contextToken, clientId });
    if (second.ok) return { ok: true, clientId };
    return { ok: false, error: second.error || `send failed (retry): ret=${second.ret}` };
  }

  return { ok: false, error: first.error || `send failed: ret=${first.ret}` };
}

function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    out.push(text.slice(i, i + max));
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
