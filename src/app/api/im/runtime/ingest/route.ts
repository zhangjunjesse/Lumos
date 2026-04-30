/**
 * POST /api/im/runtime/ingest
 *
 * Electron im-runtime-manager 把 IMAdapter 收到的 InboundMessage 通过这里上报。
 *
 * M9: 落 bridge_events 表用于可见性。
 * M10: 调 dispatchInbound 进 AI 对话循环（绑定查找 + AI 派发 + 回复送回）。
 *
 * 鉴权：runtime-token 同 bridge runtime。
 */

import { NextResponse } from 'next/server';
import { bridgeRuntimeUnauthorizedResponse, isBridgeRuntimeAuthorized } from '@/lib/bridge/runtime-auth';
import { hasProvider } from '@/lib/im';
import type { InboundMessage } from '@/lib/im';
import { getDb } from '@/lib/db';
import { dispatchInbound } from '@/lib/bridge/core/im-inbound-dispatcher';
import { handleFeishuMessage, type FeishuWebhookMessage } from '@/lib/bridge/message-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IngestBody {
  providerId?: string;
  message?: InboundMessage;
  receivedAt?: number;
}

export async function POST(request: Request) {
  if (!isBridgeRuntimeAuthorized(request)) {
    return bridgeRuntimeUnauthorizedResponse();
  }

  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const providerId = body.providerId?.trim();
  const message = body.message;
  if (!providerId || !hasProvider(providerId)) {
    return NextResponse.json({ error: 'UNKNOWN_PROVIDER' }, { status: 400 });
  }
  if (!message || !message.address?.chatId || !message.text) {
    return NextResponse.json({ error: 'INVALID_MESSAGE' }, { status: 400 });
  }

  // 落 bridge_events 用于可见性。feishu 例外：legacy handleFeishuMessage 内部有
  // 自己的事件落库（含 binding_id 解析），这里跳过避免重复。
  if (providerId !== 'feishu') {
    try {
      persistEvent(providerId, message, body.receivedAt ?? Date.now());
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'persist failed';
      console.error('[im/runtime] persist failed:', errMessage);
      return NextResponse.json({ error: errMessage }, { status: 500 });
    }
  }

  console.info('[im/runtime] inbound', {
    provider: providerId,
    chatId: message.address.chatId,
    text: message.text.slice(0, 80),
  });

  // 异步派发到 AI 对话循环。失败只记日志，不影响 ingest 200 响应（避免重发风暴）。
  void dispatchByPlatform(providerId, message)
    .then((label) => {
      console.info('[im/runtime] dispatched', { provider: providerId, via: label });
    })
    .catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[im/runtime] dispatch error:', errMsg);
    });

  return NextResponse.json({ ok: true });
}

/**
 * Phase C: 按 platform 派发：
 *   feishu → handleFeishuMessage（保留原 945 行 pipeline 的 mentions/OAuth/multimodal/retry）
 *   else   → dispatchInbound（generic 简化路径，binding 查找 + AI + sendToProvider）
 *
 * Feishu 路径要求 message.raw 是原始 FeishuWebhookMessage（FeishuMonitor 会保留它）。
 */
async function dispatchByPlatform(
  providerId: string,
  message: InboundMessage,
): Promise<string> {
  if (providerId === 'feishu') {
    const raw = (message.raw ?? null) as FeishuWebhookMessage | null;
    if (raw && typeof raw === 'object' && 'message' in raw) {
      await handleFeishuMessage(raw, { transportKind: 'websocket' });
      return 'feishu-legacy-pipeline';
    }
    // raw 缺失（异常情况），降级到 generic 派发
  }
  await dispatchInbound(providerId, message);
  return 'generic-dispatcher';
}

function persistEvent(providerId: string, msg: InboundMessage, receivedAt: number): void {
  const db = getDb();
  const eventId = `im_${providerId}_${msg.messageId}_${receivedAt}`;
  const payloadJson = JSON.stringify({
    providerId,
    chatId: msg.address.chatId,
    userId: msg.address.userId,
    text: msg.text,
    timestamp: msg.timestamp,
  });

  db.prepare(
    `INSERT OR IGNORE INTO bridge_events (
      id, binding_id, platform, direction, transport_kind, channel_id,
      platform_account_id, platform_message_id, event_type, status,
      payload_json, retry_count, created_at, updated_at
    ) VALUES (?, 0, ?, 'inbound', 'websocket', ?, 'default', ?, 'message',
              'received', ?, 0, ?, ?)`
  ).run(
    eventId,
    providerId,
    msg.address.chatId,
    msg.messageId,
    payloadJson,
    receivedAt,
    receivedAt,
  );
}
