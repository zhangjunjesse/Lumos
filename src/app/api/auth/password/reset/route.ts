import { NextRequest, NextResponse } from 'next/server';

const WEB_BASE = process.env.LUMOS_WEB_URL || 'https://lumos.miki.zj.cn';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const upstream = await fetch(`${WEB_BASE}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : '重置密码失败';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
