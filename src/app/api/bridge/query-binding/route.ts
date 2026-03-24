import { NextRequest, NextResponse } from 'next/server';
import { getBridgeService } from '@/lib/bridge/app/bridge-service';

export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get('chatId');
  if (!chatId) {
    return NextResponse.json({ error: 'Missing chatId' }, { status: 400 });
  }

  const bridgeService = getBridgeService();
  const binding = bridgeService.resolveBindingByChannel('feishu', chatId);

  if (!binding || binding.status !== 'active') {
    return NextResponse.json({ error: 'No active binding' }, { status: 404 });
  }

  return NextResponse.json({
    sessionId: binding.sessionId,
    bindingId: binding.id,
  });
}

