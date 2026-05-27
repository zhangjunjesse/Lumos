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
import path from 'node:path';
import os from 'node:os';
import type { IMFileAttachment, OutboundMessage, SendResult } from '../../core/types';
import {
  ERR_SESSION_EXPIRED,
  VOICE_FORMAT_AMR,
  VOICE_FORMAT_MP3,
  VOICE_FORMAT_SILK,
  VOICE_FORMAT_WAVE,
  WechatClient,
  newClientId,
} from './client';
import { explainWechatIlinkError } from './errors';

// The protocol examples cap text_item payloads at 2000 chars. Keep a little
// headroom for CJK/newline edge cases so accepted API responses are more likely
// to render on the phone client.
const MAX_CHUNK = 1900;
const SEND_DEBUG_LOG_PATH = path.join(
  process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos'),
  'wechat-send.log',
);

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

  let contextToken = message.providerHints?.wechat?.contextToken?.trim()
    || deps.getContextToken(peer);
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
  const audioAttachments = (message.attachments || []).filter((a) =>
    (a.type || '').toLowerCase().startsWith('audio/'),
  );
  const fileAttachments = (message.attachments || []).filter((a) =>
    !(a.type || '').toLowerCase().startsWith('image/')
    && !(a.type || '').toLowerCase().startsWith('audio/'),
  );

  if (!text && imageAttachments.length === 0 && audioAttachments.length === 0 && fileAttachments.length === 0) {
    return { ok: false, error: 'empty message' };
  }

  let lastMessageId: string | undefined;

  // 顺序：图片 → 文件 → 文本（与微信原生体验一致：媒体先到，文字说明在后）
  for (const attachment of imageAttachments) {
    const bytes = readAttachmentBytes(attachment);
    if (!bytes) {
      return { ok: false, error: `attachment "${attachment.name}" has no readable bytes` };
    }
    const result = await sendImageWithRetry(
      client,
      peer,
      bytes,
      contextToken,
      () => refreshContextToken(deps, peer, contextToken),
    );
    if (!result.ok) return { ok: false, error: explainWechatIlinkError(result.error) };
    lastMessageId = result.clientId;
    contextToken = result.contextToken || deps.getContextToken(peer) || contextToken;
  }

  for (const attachment of audioAttachments) {
    const bytes = readAttachmentBytes(attachment);
    if (!bytes) {
      return { ok: false, error: `attachment "${attachment.name}" has no readable bytes` };
    }

    if (shouldTryNativeVoice(attachment)) {
      const voice = describeNativeVoice(bytes, attachment);
      if (voice) {
        const nativeResult = await sendVoiceWithRetry(
          client,
          peer,
          bytes,
          voice,
          contextToken,
          () => refreshContextToken(deps, peer, contextToken),
        );
        if (nativeResult.ok) {
          lastMessageId = nativeResult.clientId;
          contextToken = nativeResult.contextToken || deps.getContextToken(peer) || contextToken;
          continue;
        }
        console.warn('[wechat/send] native voice send failed; falling back to file attachment:', nativeResult.error);
      }
    }

    const result = await sendFileWithRetry(
      client,
      peer,
      bytes,
      attachment.name,
      contextToken,
      () => refreshContextToken(deps, peer, contextToken),
    );
    if (!result.ok) return { ok: false, error: explainWechatIlinkError(result.error) };
    lastMessageId = result.clientId;
    contextToken = result.contextToken || deps.getContextToken(peer) || contextToken;
  }

  for (const attachment of fileAttachments) {
    const bytes = readAttachmentBytes(attachment);
    if (!bytes) {
      return { ok: false, error: `attachment "${attachment.name}" has no readable bytes` };
    }
    const result = await sendFileWithRetry(
      client,
      peer,
      bytes,
      attachment.name,
      contextToken,
      () => refreshContextToken(deps, peer, contextToken),
    );
    if (!result.ok) return { ok: false, error: explainWechatIlinkError(result.error) };
    lastMessageId = result.clientId;
    contextToken = result.contextToken || deps.getContextToken(peer) || contextToken;
  }

  if (text) {
    const chunks = splitText(text, MAX_CHUNK);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      logWechatSend(`text attempt peer=${redactPeer(peer)} chunk=${i + 1}/${chunks.length} chars=${chunk.length} ctx=${contextToken ? 'yes' : 'no'}`);
      const result = await sendOneWithRetry(
        client,
        peer,
        chunk,
        contextToken,
        () => refreshContextToken(deps, peer, contextToken),
      );
      if (!result.ok) {
        const error = explainWechatIlinkError(result.error);
        logWechatSend(`text failed peer=${redactPeer(peer)} chunk=${i + 1}/${chunks.length} error="${truncateForLog(error)}"`);
        return { ok: false, error };
      }
      lastMessageId = result.clientId;
      logWechatSend(`text ok peer=${redactPeer(peer)} chunk=${i + 1}/${chunks.length} clientId=${lastMessageId || ''}`);
      contextToken = result.contextToken || deps.getContextToken(peer) || contextToken;
    }
  }

  return { ok: true, messageId: lastMessageId };
}

function refreshContextToken(deps: SendDeps, peer: string, currentToken: string): string {
  const latest = deps.getContextToken(peer).trim();
  return latest && latest !== currentToken ? latest : '';
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

function shouldTryNativeVoice(attachment: IMFileAttachment): boolean {
  const hinted = attachment.providerHints?.wechat?.nativeVoice;
  if (typeof hinted === 'boolean') return hinted;
  return process.env.WECHAT_NATIVE_VOICE_REPLY === '1';
}

async function sendImageWithRetry(
  client: WechatClient,
  peer: string,
  bytes: Buffer,
  contextToken: string,
  refreshToken: () => string,
): Promise<SendOneResult> {
  const clientId = newClientId();
  const first = await client.sendImage({ toUserId: peer, bytes, contextToken, clientId });
  if (first.ok) return { ok: true, clientId, contextToken };

  if (first.ret === -2 || first.ret === ERR_SESSION_EXPIRED) {
    await delay(500);
    const retryToken = refreshToken() || contextToken;
    const second = await client.sendImage({ toUserId: peer, bytes, contextToken: retryToken, clientId });
    if (second.ok) return { ok: true, clientId, contextToken: retryToken };
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
  refreshToken: () => string,
): Promise<SendOneResult> {
  const clientId = newClientId();
  const first = await client.sendFile({ toUserId: peer, bytes, fileName, contextToken, clientId });
  if (first.ok) return { ok: true, clientId, contextToken };

  if (first.ret === -2 || first.ret === ERR_SESSION_EXPIRED) {
    await delay(500);
    const retryToken = refreshToken() || contextToken;
    const second = await client.sendFile({ toUserId: peer, bytes, fileName, contextToken: retryToken, clientId });
    if (second.ok) return { ok: true, clientId, contextToken: retryToken };
    return { ok: false, error: second.error || `sendFile failed (retry): ret=${second.ret}` };
  }

  return { ok: false, error: first.error || `sendFile failed: ret=${first.ret}` };
}

interface NativeVoiceDescription {
  encodeType: number;
  sampleRate?: number;
  bitsPerSample?: number;
  playtime?: number;
}

async function sendVoiceWithRetry(
  client: WechatClient,
  peer: string,
  bytes: Buffer,
  voice: NativeVoiceDescription,
  contextToken: string,
  refreshToken: () => string,
): Promise<SendOneResult> {
  const clientId = newClientId();
  const first = await client.sendVoice({
    toUserId: peer,
    bytes,
    contextToken,
    clientId,
    encodeType: voice.encodeType,
    sampleRate: voice.sampleRate,
    bitsPerSample: voice.bitsPerSample,
    playtime: voice.playtime,
  });
  if (first.ok) return { ok: true, clientId, contextToken };

  if (first.ret === -2 || first.ret === ERR_SESSION_EXPIRED) {
    await delay(500);
    const retryToken = refreshToken() || contextToken;
    const second = await client.sendVoice({
      toUserId: peer,
      bytes,
      contextToken: retryToken,
      clientId,
      encodeType: voice.encodeType,
      sampleRate: voice.sampleRate,
      bitsPerSample: voice.bitsPerSample,
      playtime: voice.playtime,
    });
    if (second.ok) return { ok: true, clientId, contextToken: retryToken };
    return { ok: false, error: second.error || `sendVoice failed (retry): ret=${second.ret}` };
  }

  return { ok: false, error: first.error || `sendVoice failed: ret=${first.ret}` };
}

interface SendOneResult {
  ok: boolean;
  error?: string;
  clientId?: string;
  contextToken?: string;
}

async function sendOneWithRetry(
  client: WechatClient,
  peer: string,
  text: string,
  contextToken: string,
  refreshToken: () => string,
): Promise<SendOneResult> {
  const clientId = newClientId();
  const first = await client.sendText({ toUserId: peer, text, contextToken, clientId });
  if (first.ok) return { ok: true, clientId, contextToken };

  // ret=-2 means context_token stale; retry once with anything we have.
  // In packaged Windows runs, inbound monitoring and reply sending happen in
  // different processes. The user may send a newer message while the AI is
  // still thinking, so retry with the latest token persisted by the monitor.
  if (first.ret === -2 || first.ret === ERR_SESSION_EXPIRED || isRetryableSendError(first.error)) {
    await delay(500);
    const retryToken = refreshToken() || contextToken;
    const second = await client.sendText({ toUserId: peer, text, contextToken: retryToken, clientId });
    if (second.ok) return { ok: true, clientId, contextToken: retryToken };
    return { ok: false, error: second.error || `send failed (retry): ret=${second.ret}` };
  }

  return { ok: false, error: first.error || `send failed: ret=${first.ret}` };
}

function isRetryableSendError(error: string | undefined): boolean {
  if (!error) return false;
  return /(?:operation was aborted|abort|timed out|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR)/i.test(error);
}

function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf('\n\n', max);
    if (cut < Math.floor(max * 0.55)) cut = remaining.lastIndexOf('\n', max);
    if (cut < Math.floor(max * 0.55)) cut = remaining.lastIndexOf('。', max);
    if (cut < Math.floor(max * 0.55)) cut = remaining.lastIndexOf('；', max);
    if (cut < Math.floor(max * 0.55)) cut = remaining.lastIndexOf('，', max);
    if (cut < Math.floor(max * 0.55)) cut = max;
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) out.push(remaining);
  return out;
}

function logWechatSend(line: string): void {
  const stamped = `[${new Date().toISOString()}] [wechat/send] ${line}\n`;
  try {
    fs.appendFileSync(SEND_DEBUG_LOG_PATH, stamped);
  } catch {
    // best-effort diagnostic only
  }
}

function redactPeer(peer: string): string {
  const trimmed = peer.trim();
  if (!trimmed) return '(empty)';
  const at = trimmed.indexOf('@');
  const head = at >= 0 ? trimmed.slice(0, at) : trimmed;
  const suffix = at >= 0 ? trimmed.slice(at) : '';
  if (head.length <= 8) return `${head}${suffix}`;
  return `${head.slice(0, 4)}…${head.slice(-4)}${suffix}`;
}

function truncateForLog(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 240)}...`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeNativeVoice(bytes: Buffer, attachment: IMFileAttachment): NativeVoiceDescription | null {
  const type = (attachment.type || '').toLowerCase();
  const name = (attachment.name || '').toLowerCase();

  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') {
    return {
      encodeType: VOICE_FORMAT_WAVE,
      ...parseWavAudioMeta(bytes),
    };
  }

  if (type.includes('mpeg') || type.includes('mp3') || name.endsWith('.mp3') || looksLikeMp3(bytes)) {
    return {
      encodeType: VOICE_FORMAT_MP3,
      sampleRate: 24_000,
      bitsPerSample: 16,
      playtime: estimateCompressedPlaytime(bytes.length, 48_000),
    };
  }

  if (type.includes('amr') || name.endsWith('.amr') || bytes.subarray(0, 5).toString('ascii') === '#!AMR') {
    return {
      encodeType: VOICE_FORMAT_AMR,
      sampleRate: 8_000,
      bitsPerSample: 16,
      playtime: estimateCompressedPlaytime(bytes.length, 12_200),
    };
  }

  if (type.includes('silk') || name.endsWith('.silk')) {
    return {
      encodeType: VOICE_FORMAT_SILK,
      sampleRate: 24_000,
      bitsPerSample: 16,
      playtime: estimateCompressedPlaytime(bytes.length, 24_000),
    };
  }

  return null;
}

function parseWavAudioMeta(bytes: Buffer): Omit<NativeVoiceDescription, 'encodeType'> {
  let offset = 12;
  let sampleRate = 24_000;
  let bitsPerSample = 16;
  let channels = 1;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > bytes.length) break;

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      channels = Math.max(1, bytes.readUInt16LE(chunkStart + 2));
      sampleRate = bytes.readUInt32LE(chunkStart + 4) || sampleRate;
      bitsPerSample = bytes.readUInt16LE(chunkStart + 14) || bitsPerSample;
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  const bytesPerSecond = sampleRate * channels * Math.max(1, bitsPerSample / 8);
  const playtime = dataSize > 0 && bytesPerSecond > 0
    ? Math.max(1, Math.round((dataSize / bytesPerSecond) * 1000))
    : undefined;

  return { sampleRate, bitsPerSample, playtime };
}

function estimateCompressedPlaytime(byteLength: number, bitsPerSecond: number): number {
  if (byteLength <= 0 || bitsPerSecond <= 0) return 1;
  return Math.max(1, Math.round((byteLength * 8 / bitsPerSecond) * 1000));
}

function looksLikeMp3(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}
