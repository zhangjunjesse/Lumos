import { NextResponse } from 'next/server';
import { getBridgeConnection } from '@/lib/bridge/storage/bridge-connection-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildPayload() {
  return {
    managedBy: 'electron-runtime',
    connection: getBridgeConnection('feishu', 'default', 'websocket'),
  };
}

export async function GET() {
  return NextResponse.json({
    status: 'deprecated',
    ...buildPayload(),
  });
}

export async function POST() {
  return NextResponse.json(
    {
      status: 'managed_by_electron_runtime',
      ...buildPayload(),
    },
    { status: 410 },
  );
}

export async function DELETE() {
  return NextResponse.json({
    status: 'managed_by_electron_runtime',
    ...buildPayload(),
  });
}
