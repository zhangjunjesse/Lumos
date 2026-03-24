import { NextRequest, NextResponse } from 'next/server';
import { getBridgeService } from '@/lib/bridge/app/bridge-service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json(
      { error: 'sessionId required', code: 'MISSING_PARAMETER' },
      { status: 400 }
    );
  }

  const bridgeService = getBridgeService();
  const stats = bridgeService.getSyncStats(sessionId, 'feishu');

  if (!stats) {
    return NextResponse.json(
      { error: 'Binding not found', code: 'NOT_FOUND' },
      { status: 404 }
    );
  }

  return NextResponse.json({ stats });
}

