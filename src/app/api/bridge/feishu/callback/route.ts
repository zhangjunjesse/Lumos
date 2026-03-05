import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';

export async function POST(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    console.log('[Feishu Callback] Token:', token);

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const db = getDb();
    const binding = db.prepare(
      'SELECT id, lumos_session_id as sessionId FROM session_bindings WHERE bind_token = ? AND status = ?'
    ).get(token, 'pending');

    console.log('[Feishu Callback] Binding:', binding);

    if (!binding) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
    }

    const feishuApi = new FeishuAPI(
      process.env.FEISHU_APP_ID!,
      process.env.FEISHU_APP_SECRET!
    );

    const session = db.prepare('SELECT title FROM chat_sessions WHERE id = ?').get(binding.sessionId) as any;
    console.log('[Feishu Callback] Session:', session);

    const chat = await feishuApi.createChat(`Lumos - ${session?.title || 'Chat'}`, 'Lumos AI助手');
    console.log('[Feishu Callback] Chat created:', chat);

    const link = await feishuApi.createChatLink(chat.chat_id);
    console.log('[Feishu Callback] Link created:', link);

    db.prepare(
      'UPDATE session_bindings SET platform_chat_id = ?, status = ?, updated_at = ? WHERE id = ?'
    ).run(chat.chat_id, 'active', Date.now(), binding.id);

    return NextResponse.json({ chatId: chat.chat_id, shareLink: link.share_link });
  } catch (error: any) {
    console.error('[Feishu Callback] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
