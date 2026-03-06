import { NextRequest, NextResponse } from 'next/server';
import { getSessionBindingByPlatformChat } from '@/lib/db/feishu-bridge';

export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get('chatId');
  if (!chatId) {
    return NextResponse.json({ error: 'Missing chatId' }, { status: 400 });
  }

  const binding = getSessionBindingByPlatformChat('feishu', chatId);

  if (!binding || binding.status !== 'active') {
    return NextResponse.json({ error: 'No active binding' }, { status: 404 });
  }

  return NextResponse.json({
    sessionId: binding.lumos_session_id,
    bindingId: binding.id
  });
}
