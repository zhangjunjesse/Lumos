import { NextRequest, NextResponse } from 'next/server';
import { getBridgeService } from '@/lib/bridge/app/bridge-service';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json(
      { error: 'sessionId required', code: 'MISSING_PARAMETER' },
      { status: 400 },
    );
  }

  try {
    const bridgeService = getBridgeService();
    const health = bridgeService.getSessionHealth(sessionId);
    return NextResponse.json(health);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to query bridge health';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
