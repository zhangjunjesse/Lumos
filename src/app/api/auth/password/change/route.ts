import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/connection';
import { getUserBySession } from '@/lib/auth/user-service';

const WEB_BASE = process.env.LUMOS_WEB_URL || 'https://lumos.miki.zj.cn';
const WEB_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export async function POST(req: NextRequest) {
  try {
    const localToken = req.cookies.get('lumos_session')?.value;
    if (!localToken) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const user = getUserBySession(localToken);
    if (!user) {
      return NextResponse.json({ success: false, message: '会话已过期' }, { status: 401 });
    }

    const db = getDb();
    const row = db.prepare('SELECT web_session_token FROM lumos_users WHERE id = ?').get(user.id) as { web_session_token?: string } | undefined;
    const webToken = row?.web_session_token?.trim() || '';
    if (!WEB_TOKEN_PATTERN.test(webToken)) {
      return NextResponse.json({ success: false, message: '云端登录已失效，请重新登录' }, { status: 401 });
    }

    const body = await req.text();
    const upstream = await fetch(`${WEB_BASE}/api/auth/password/change`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${webToken}`,
      },
      body,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : '修改密码失败';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
