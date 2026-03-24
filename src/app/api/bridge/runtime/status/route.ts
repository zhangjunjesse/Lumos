import { NextResponse } from 'next/server';
import { bridgeRuntimeUnauthorizedResponse, isBridgeRuntimeAuthorized } from '@/lib/bridge/runtime-auth';
import {
  upsertBridgeConnection,
  type BridgeTransportKind,
  type BridgeTransportStatus,
} from '@/lib/bridge/storage/bridge-connection-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RuntimeStatusBody {
  platform?: 'feishu';
  accountId?: string;
  transportKind?: BridgeTransportKind;
  status?: BridgeTransportStatus;
  lastConnectedAt?: number | null;
  lastDisconnectedAt?: number | null;
  lastEventAt?: number | null;
  lastErrorAt?: number | null;
  lastErrorMessage?: string | null;
}

export async function POST(request: Request) {
  if (!isBridgeRuntimeAuthorized(request)) {
    return bridgeRuntimeUnauthorizedResponse();
  }

  let body: RuntimeStatusBody;
  try {
    body = await request.json() as RuntimeStatusBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (body.platform !== 'feishu') {
    return NextResponse.json({ error: 'UNSUPPORTED_PLATFORM' }, { status: 400 });
  }

  if (!body.status) {
    return NextResponse.json({ error: 'MISSING_STATUS' }, { status: 400 });
  }

  const record = upsertBridgeConnection({
    platform: body.platform,
    accountId: body.accountId || 'default',
    transportKind: body.transportKind || 'websocket',
    status: body.status,
    lastConnectedAt: typeof body.lastConnectedAt === 'number' ? body.lastConnectedAt : undefined,
    lastDisconnectedAt: typeof body.lastDisconnectedAt === 'number' ? body.lastDisconnectedAt : undefined,
    lastEventAt: typeof body.lastEventAt === 'number' ? body.lastEventAt : undefined,
    lastErrorAt: body.lastErrorAt,
    lastErrorMessage: body.lastErrorMessage,
  });

  return NextResponse.json({ ok: true, connection: record });
}
