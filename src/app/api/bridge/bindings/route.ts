import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { randomBytes } from 'crypto';

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
    const token = randomBytes(32).toString('hex');
    const bindingId = randomBytes(16).toString('hex');

    db.prepare(
      `INSERT INTO session_bindings (id, session_id, chat_id, channel_type, status)
       VALUES (?, ?, ?, 'feishu', 'pending')`
    ).run(bindingId, sessionId, token);

    const qrUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/bridge/bind?token=${token}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    return NextResponse.json({ bindToken: token, qrUrl, expiresAt });
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
      `SELECT id, chat_id as chatId, status, created_at as createdAt
       FROM session_bindings WHERE session_id = ? AND status != 'deleted'`
    ).all(sessionId);

    return NextResponse.json({ bindings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
