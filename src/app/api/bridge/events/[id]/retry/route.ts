import { NextRequest, NextResponse } from 'next/server';
import { getBridgeService } from '@/lib/bridge/app/bridge-service';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const bridgeService = getBridgeService();
    await bridgeService.retryEvent(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to retry bridge event';
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

