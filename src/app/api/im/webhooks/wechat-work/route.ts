/**
 * WeChat Work Webhook Endpoint
 *
 * 在企微管理后台「应用 → 接收消息 → 设置 API 接收」配置：
 *   URL:  http://your-host:port/api/im/webhooks/wechat-work
 *   Token / EncodingAESKey:  Settings → IM → 企业微信 配置卡片对应字段
 *
 * 流程：
 *   GET  → URL 验证（企微一次性发起，要求把 echostr 解密后回原文）
 *   POST → 推送加密的消息事件，本路由解密后注入 wechat-work adapter
 */

import { NextRequest } from 'next/server';
import { startAdapter, getActiveAdapter } from '@/lib/im';
import {
  decryptMessage,
  extractXmlField,
  verifySignature,
  WXBizMsgCryptError,
} from '@/lib/im/providers/wechat-work/crypto';
import type { InboundMessage } from '@/lib/im';
import { dispatchInbound } from '@/lib/bridge/core/im-inbound-dispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROVIDER_ID = 'wechat-work';

interface WechatWorkAdapterShape {
  getCallbackCredentials(): { token: string; aesKey: string; corpId: string };
  injectInbound(message: InboundMessage): void;
}

function isWechatWorkAdapter(adapter: unknown): adapter is WechatWorkAdapterShape {
  return (
    !!adapter &&
    typeof (adapter as WechatWorkAdapterShape).getCallbackCredentials === 'function' &&
    typeof (adapter as WechatWorkAdapterShape).injectInbound === 'function'
  );
}

async function getAdapter(): Promise<WechatWorkAdapterShape | null> {
  try {
    await startAdapter(PROVIDER_ID);
  } catch {
    return null;
  }
  const adapter = getActiveAdapter(PROVIDER_ID);
  return isWechatWorkAdapter(adapter) ? adapter : null;
}

async function getCredentials(): Promise<{ token: string; aesKey: string; corpId: string } | null> {
  const adapter = await getAdapter();
  if (!adapter) return null;
  const creds = adapter.getCallbackCredentials();
  if (!creds.token || !creds.aesKey || !creds.corpId) return null;
  return creds;
}

/**
 * GET /api/im/webhooks/wechat-work
 *   Query: msg_signature, timestamp, nonce, echostr
 *   返回：解密后的 echostr 明文（裸 string，不能加 JSON）
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const signature = url.searchParams.get('msg_signature') || '';
  const timestamp = url.searchParams.get('timestamp') || '';
  const nonce = url.searchParams.get('nonce') || '';
  const echostr = url.searchParams.get('echostr') || '';

  if (!signature || !timestamp || !nonce || !echostr) {
    return new Response('missing query', { status: 400 });
  }

  const creds = await getCredentials();
  if (!creds) return new Response('wechat-work not configured', { status: 503 });

  if (!verifySignature({ token: creds.token, timestamp, nonce, encrypt: echostr, signature })) {
    return new Response('invalid signature', { status: 401 });
  }

  try {
    const { plaintext } = decryptMessage({
      encodingAesKey: creds.aesKey,
      encrypt: echostr,
      expectedCorpId: creds.corpId,
    });
    return new Response(plaintext, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  } catch (err) {
    const code = err instanceof WXBizMsgCryptError ? err.code : 'DECRYPT_FAILED';
    return new Response(code, { status: 400 });
  }
}

/**
 * POST /api/im/webhooks/wechat-work
 *   Query: msg_signature, timestamp, nonce
 *   Body: XML containing <Encrypt><![CDATA[...]]></Encrypt>
 *   解密 → 解析 → 注入 adapter 的 monitor 队列
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const signature = url.searchParams.get('msg_signature') || '';
  const timestamp = url.searchParams.get('timestamp') || '';
  const nonce = url.searchParams.get('nonce') || '';

  if (!signature || !timestamp || !nonce) {
    return new Response('missing query', { status: 400 });
  }

  const xml = await request.text();
  const encrypt = extractXmlField(xml, 'Encrypt');
  if (!encrypt) return new Response('missing Encrypt', { status: 400 });

  const creds = await getCredentials();
  if (!creds) return new Response('wechat-work not configured', { status: 503 });

  if (!verifySignature({ token: creds.token, timestamp, nonce, encrypt, signature })) {
    return new Response('invalid signature', { status: 401 });
  }

  let plaintext: string;
  try {
    const result = decryptMessage({
      encodingAesKey: creds.aesKey,
      encrypt,
      expectedCorpId: creds.corpId,
    });
    plaintext = result.plaintext;
  } catch (err) {
    const code = err instanceof WXBizMsgCryptError ? err.code : 'DECRYPT_FAILED';
    return new Response(code, { status: 400 });
  }

  const adapter = await getAdapter();
  if (!adapter) {
    return new Response('adapter not running', { status: 503 });
  }

  const inbound = parseInboundFromXml(plaintext);
  if (inbound) {
    // 仍然注入 monitor 队列（保留 consumeOne 接口语义）
    try {
      adapter.injectInbound(inbound);
    } catch (err) {
      console.error('[wechat-work webhook] inject failed:', err);
    }
    // 异步派发到 AI 对话循环，立刻响应（企微 5 秒超时）
    void dispatchInbound('wechat-work', inbound)
      .then((result) => {
        if (!result.ok) console.info('[wechat-work webhook] dispatch:', result);
      })
      .catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[wechat-work webhook] dispatch error:', errMsg);
      });
  }

  // 企微要求 5 秒内回应；立刻响应空字符串
  return new Response('', { status: 200 });
}

function parseInboundFromXml(xml: string): InboundMessage | null {
  const fromUser = extractXmlField(xml, 'FromUserName');
  const msgType = extractXmlField(xml, 'MsgType');
  const msgId = extractXmlField(xml, 'MsgId') ?? extractXmlField(xml, 'EventKey') ?? '';
  const content = extractXmlField(xml, 'Content') ?? '';
  const createTime = extractXmlField(xml, 'CreateTime') ?? '';

  if (!fromUser || !msgType) return null;
  // M5 范围：仅处理 text。其它（image / event / 等）后续扩展。
  if (msgType !== 'text') return null;
  if (!content.trim()) return null;

  return {
    messageId: msgId || `${fromUser}:${createTime}`,
    address: { providerId: PROVIDER_ID, chatId: fromUser, userId: fromUser },
    text: content.trim(),
    timestamp: parseInt(createTime, 10) * 1000 || Date.now(),
    raw: xml,
  };
}
