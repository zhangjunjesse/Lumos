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

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NextResponse } from 'next/server';
import { bridgeRuntimeUnauthorizedResponse, isBridgeRuntimeAuthorized } from '@/lib/bridge/runtime-auth';
import { hasProvider } from '@/lib/im';
import type { InboundMessage } from '@/lib/im';
import { getDb } from '@/lib/db';
import { dispatchInbound, type DispatchResult } from '@/lib/bridge/core/im-inbound-dispatcher';
import { handleFeishuMessage, type FeishuWebhookMessage } from '@/lib/bridge/message-handler';

const IM_DEBUG_LOG = path.join(
  process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos'),
  'im-runtime.log',
);

function imDbg(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  console.info(line);
  try {
    fs.appendFileSync(IM_DEBUG_LOG, stamped);
  } catch {
    // ignore
  }
}

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

  // 落 bridge_events 用于可见性。
  //   feishu: legacy handleFeishuMessage 内部已自行落库（含 binding_id 解析），跳过避免重复。
  //   wechat: 固定进入主 Agent，不存在 chat ↔ session 的 binding，
  //           bridge_events.binding_id 是 NOT NULL + FK，强写就会 FOREIGN KEY 失败。
  //           wechat 的可见性日后另起 wechat 专属表（M+1），现在不阻塞派发。
  if (providerId !== 'feishu' && providerId !== 'wechat') {
    try {
      persistEvent(providerId, message, body.receivedAt ?? Date.now());
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'persist failed';
      console.error('[im/runtime] persist failed:', errMessage);
      return NextResponse.json({ error: errMessage }, { status: 500 });
    }
  }

  imDbg(
    `[im/ingest] inbound provider=${providerId} chatId=${message.address.chatId} text="${message.text.slice(0, 60)}"`,
  );

  // 异步派发到 AI 对话循环。失败只记日志，不影响 ingest 200 响应（避免重发风暴）。
  void dispatchByPlatform(providerId, message)
    .then((outcome) => {
      if ('result' in outcome) {
        const r = outcome.result;
        imDbg(
          `[im/ingest] dispatched provider=${providerId} via=${outcome.via} ok=${r.ok}` +
            (r.ok
              ? ` session=${r.sessionId} replyId=${r.replyMessageId ?? ''}`
              : ` reason="${r.reason ?? ''}"`),
        );
      } else {
        imDbg(`[im/ingest] dispatched provider=${providerId} via=${outcome.via} (no detail)`);
      }
    })
    .catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
      imDbg(`[im/ingest] dispatch ERROR provider=${providerId}: ${errMsg}${stack}`);
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
type DispatchOutcome =
  | { via: string; result: DispatchResult }
  | { via: string };

async function dispatchByPlatform(
  providerId: string,
  message: InboundMessage,
): Promise<DispatchOutcome> {
  if (providerId === 'feishu') {
    const raw = (message.raw ?? null) as FeishuWebhookMessage | null;
    if (raw && typeof raw === 'object' && 'message' in raw) {
      await handleFeishuMessage(raw, { transportKind: 'websocket' });
      return { via: 'feishu-legacy-pipeline' };
    }
    // raw 缺失（异常情况），降级到 generic 派发
  }
  const result = await dispatchInbound(providerId, message);
  return { via: 'generic-dispatcher', result };
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
