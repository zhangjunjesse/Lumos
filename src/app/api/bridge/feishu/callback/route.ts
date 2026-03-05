import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';

export async function POST(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const db = getDb();
    const binding = db.prepare(
      'SELECT id, session_id as sessionId FROM session_bindings WHERE chat_id = ? AND status = ?'
    ).get(token, 'pending');

    if (!binding) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
    }

    const feishuApi = new FeishuAPI(
      process.env.FEISHU_APP_ID!,
      process.env.FEISHU_APP_SECRET!
    );

    const session = db.prepare('SELECT title FROM chat_sessions WHERE id = ?').get(binding.sessionId) as any;
    const chat = await feishuApi.createChat(`Lumos - ${session?.title || 'Chat'}`, 'Lumos AI助手');
    const link = await feishuApi.createChatLink(chat.chat_id);

    db.prepare(
      'UPDATE session_bindings SET chat_id = ?, status = ?, updated_at = datetime(?) WHERE id = ?'
    ).run(chat.chat_id, 'active', 'now', binding.id);

    return NextResponse.json({ chatId: chat.chat_id, shareLink: link.share_link });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
