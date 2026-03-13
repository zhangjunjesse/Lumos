import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';
import Database from 'better-sqlite3';
import { requireActiveFeishuUserAuth } from '@/lib/bridge/feishu-auth-guard';
import { getFeishuCredentials, isFeishuConfigured } from '@/lib/feishu-config';
import { ensureActiveFeishuToken } from '@/lib/feishu-auth';

interface StoredMessageRow {
  role: string;
  content: string;
}

interface ActiveBindingRow {
  platform_chat_id: string;
  platform_chat_name?: string;
  share_link?: string;
}

interface ChatSessionRow {
  title?: string;
}

function ensureBindingMetadataColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(session_bindings)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('platform_chat_name')) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN platform_chat_name TEXT NOT NULL DEFAULT ''");
  }

  if (!names.has('share_link')) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN share_link TEXT NOT NULL DEFAULT ''");
  }
}

async function syncHistoryMessages(
  db: Database.Database,
  feishuApi: FeishuAPI,
  sessionId: string,
  chatId: string
) {
  const messages = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as StoredMessageRow[];

  for (const msg of messages) {
    const cardContent = {
      config: { wide_screen_mode: true },
      header: {
        title: {
          tag: 'plain_text',
          content: msg.role === 'user' ? '👤 用户' : '🤖 AI',
        },
        template: msg.role === 'user' ? 'blue' : 'green',
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: msg.content } },
      ],
    };

    try {
      const token = await feishuApi.getToken();
      await fetch(
        'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'interactive',
            content: JSON.stringify(cardContent),
          }),
        },
      );
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

    if (!isFeishuConfigured()) {
      return NextResponse.json({
        error: 'FEISHU_NOT_CONFIGURED',
        message: '请先配置飞书应用',
        action: 'goto_settings'
      }, { status: 400 });
    }

    await ensureActiveFeishuToken();
    const auth = requireActiveFeishuUserAuth();
    if (!auth.ok) {
      return NextResponse.json(
        {
          error: auth.code,
          message: auth.message,
          action: 'goto_feishu_login',
        },
        { status: 401 },
      );
    }

    const db = getDb();
    ensureBindingMetadataColumns(db);
    const { appId, appSecret } = getFeishuCredentials();
    const feishuApi = new FeishuAPI(appId, appSecret);

    // 检查是否已有绑定
    const existing = db.prepare(
      'SELECT platform_chat_id FROM session_bindings WHERE lumos_session_id = ? AND platform = ? AND status = ?'
    ).get(sessionId, 'feishu', 'active') as ActiveBindingRow | undefined;

    if (existing?.platform_chat_id) {
      const link = await feishuApi.createChatLink(existing.platform_chat_id);
      db.prepare(
        'UPDATE session_bindings SET share_link = ?, updated_at = ? WHERE lumos_session_id = ? AND platform = ? AND status = ?',
      ).run(link.share_link, Date.now(), sessionId, 'feishu', 'active');
      return NextResponse.json({ chatId: existing.platform_chat_id, shareLink: link.share_link });
    }

    const session = db.prepare('SELECT title FROM chat_sessions WHERE id = ?').get(sessionId) as ChatSessionRow | undefined;
    const chatName = `Lumos - ${session?.title || 'Chat'}`;
    const chat = await feishuApi.createChat(chatName, 'Lumos AI助手');
    const link = await feishuApi.createChatLink(chat.chat_id);

    const now = Date.now();
    db.prepare(
      `INSERT INTO session_bindings (
         lumos_session_id,
         platform,
         platform_chat_id,
         platform_chat_name,
         share_link,
         status,
         created_at,
         updated_at
       )
       VALUES (?, 'feishu', ?, ?, ?, 'active', ?, ?)`
    ).run(sessionId, chat.chat_id, chatName, link.share_link, now, now);

    // 同步历史消息
    await syncHistoryMessages(db, feishuApi, sessionId, chat.chat_id);

    return NextResponse.json({ chatId: chat.chat_id, shareLink: link.share_link });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create binding';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const db = getDb();
    ensureBindingMetadataColumns(db);
    const bindings = db.prepare(
      `SELECT
         id,
         lumos_session_id as session_id,
         lumos_session_id as sessionId,
         platform,
         platform_chat_id,
         platform_chat_id as chatId,
         platform_chat_name,
         share_link,
         status,
         created_at,
         created_at as createdAt,
         updated_at
       FROM session_bindings
       WHERE lumos_session_id = ?
         AND platform = 'feishu'
         AND status != 'deleted'`
    ).all(sessionId);

    return NextResponse.json({ bindings });
  } catch (error) {
    console.error('[Bindings GET] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to query bindings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
