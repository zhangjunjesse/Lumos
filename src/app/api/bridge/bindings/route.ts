import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';

async function syncHistoryMessages(db: Database.Database, feishuApi: FeishuAPI, sessionId: string, chatId: string) {
  const messages = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as any[];

  for (const msg of messages) {
    const card = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: msg.role === 'user' ? '👤 用户' : '🤖 AI' },
          template: msg.role === 'user' ? 'blue' : 'green'
        },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: msg.content } }]
      }
    };

    try {
      const token = await feishuApi.getToken();
      await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receive_id: chatId, ...card })
      });
    } catch (err) {
      console.error('[Sync] Failed to sync message:', err);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
      return NextResponse.json({
        error: 'FEISHU_NOT_CONFIGURED',
        message: '请先配置飞书应用',
        action: 'goto_settings'
      }, { status: 400 });
    }

    const db = getDb();
    const feishuApi = new FeishuAPI(process.env.FEISHU_APP_ID, process.env.FEISHU_APP_SECRET);

    // 检查是否已有绑定
    const existing = db.prepare(
      'SELECT platform_chat_id FROM session_bindings WHERE lumos_session_id = ? AND platform = ? AND status = ?'
    ).get(sessionId, 'feishu', 'active') as any;

    if (existing?.platform_chat_id) {
      const link = await feishuApi.createChatLink(existing.platform_chat_id);
      return NextResponse.json({ chatId: existing.platform_chat_id, shareLink: link.share_link });
    }

    const session = db.prepare('SELECT title FROM chat_sessions WHERE id = ?').get(sessionId) as any;
    const chat = await feishuApi.createChat(`Lumos - ${session?.title || 'Chat'}`, 'Lumos AI助手');
    const link = await feishuApi.createChatLink(chat.chat_id);

    const now = Date.now();
    db.prepare(
      `INSERT INTO session_bindings (lumos_session_id, platform, platform_chat_id, status, created_at, updated_at)
       VALUES (?, 'feishu', ?, 'active', ?, ?)`
    ).run(sessionId, chat.chat_id, now, now);

    // 同步历史消息
    await syncHistoryMessages(db, feishuApi, sessionId, chat.chat_id);

    return NextResponse.json({ chatId: chat.chat_id, shareLink: link.share_link });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const db = getDb();
    const bindings = db.prepare(
      `SELECT id, platform_chat_id as chatId, status, created_at as createdAt
       FROM session_bindings WHERE lumos_session_id = ? AND status != 'deleted'`
    ).all(sessionId);

    return NextResponse.json({ bindings });
  } catch (error: any) {
    console.error('[Bindings GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
