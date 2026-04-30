/**
 * POST /api/im/runtime/ingest
 *
 * Electron im-runtime-manager 把 IMAdapter 收到的 InboundMessage 通过这里上报。
 *
 * M9 范围：把消息记录到 bridge_events 表（platform 字段已通用化），
 * 提供给 UI / 历史查询用。**暂不**触发 AI 对话——非 feishu 的 inbound pipeline
 * 会在 M10 单独建。这一层做完后再接通端到端。
 *
 * 鉴权：runtime-token 同 bridge runtime。
 */

import { NextResponse } from 'next/server';
import { bridgeRuntimeUnauthorizedResponse, isBridgeRuntimeAuthorized } from '@/lib/bridge/runtime-auth';
import { hasProvider } from '@/lib/im';
import type { InboundMessage } from '@/lib/im';
import { getDb } from '@/lib/db';

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

  // 落 bridge_events 用于可见性，platform 字段直接用 IM provider id（schema 已通用化）
  // binding_id 此时未必存在；用 0 占位，后续 M10 完整 pipeline 会补 binding 解析。
  try {
    persistEvent(providerId, message, body.receivedAt ?? Date.now());
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : 'persist failed';
    console.error('[im/runtime] persist failed:', errMessage);
    return NextResponse.json({ error: errMessage }, { status: 500 });
  }

  console.info('[im/runtime] inbound', {
    provider: providerId,
    chatId: message.address.chatId,
    text: message.text.slice(0, 80),
  });

  return NextResponse.json({ ok: true });
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
