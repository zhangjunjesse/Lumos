import { NextRequest, NextResponse } from 'next/server';

const WEB_BASE = process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';

/**
 * POST /api/auth/send-code — Pass-through proxy to lumos-web.
 * Email sending lives on lumos-web; desktop has no SMTP config.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const upstream = await fetch(`${WEB_BASE}/api/email/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : '发送验证码失败';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
