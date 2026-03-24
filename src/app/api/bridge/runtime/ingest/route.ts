import { NextResponse } from 'next/server';
import { bridgeRuntimeUnauthorizedResponse, isBridgeRuntimeAuthorized } from '@/lib/bridge/runtime-auth';
import { handleFeishuMessage, type FeishuWebhookMessage } from '@/lib/bridge/message-handler';
import {
  recordBridgeConnectionError,
  upsertBridgeConnection,
} from '@/lib/bridge/storage/bridge-connection-repo';
import type { BridgeEventTransportKind } from '@/lib/bridge/storage/bridge-event-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RuntimeIngestBody {
  platform?: 'feishu';
  accountId?: string;
  receivedAt?: number;
  transportKind?: BridgeEventTransportKind;
  event?: FeishuWebhookMessage;
}

export async function POST(request: Request) {
  if (!isBridgeRuntimeAuthorized(request)) {
    return bridgeRuntimeUnauthorizedResponse();
  }

  let body: RuntimeIngestBody;
  try {
    body = await request.json() as RuntimeIngestBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (body.platform !== 'feishu') {
    return NextResponse.json({ error: 'UNSUPPORTED_PLATFORM' }, { status: 400 });
  }

  if (!body.event) {
    return NextResponse.json({ error: 'MISSING_EVENT' }, { status: 400 });
  }

  const accountId = body.accountId || 'default';
  const receivedAt = body.receivedAt ?? Date.now();
  const transportKind = body.transportKind || 'websocket';
  const messageId = body.event?.message?.message_id || '';
  const chatId = body.event?.message?.chat_id || '';
  const messageType = body.event?.message?.message_type || '';

  upsertBridgeConnection({
    platform: 'feishu',
    accountId,
    transportKind: 'websocket',
    status: 'connected',
    lastEventAt: receivedAt,
  });

  try {
    console.info('[bridge-runtime] ingest event', {
      accountId,
      chatId,
      messageId,
      messageType,
      transportKind,
      receivedAt,
    });
    await handleFeishuMessage(body.event, { transportKind });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to ingest runtime event';
    console.error('[bridge-runtime] ingest failed', {
      accountId,
      chatId,
      messageId,
      messageType,
      transportKind,
      error: message,
    });
    recordBridgeConnectionError({
      platform: 'feishu',
      accountId,
      transportKind: 'websocket',
      errorMessage: message,
      at: Date.now(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
