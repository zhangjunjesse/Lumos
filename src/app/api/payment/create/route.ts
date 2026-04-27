import { NextRequest, NextResponse } from 'next/server';
import { getUserBySession } from '@/lib/auth/user-service';
import { getDb } from '@/lib/db/connection';

/**
 * POST /api/payment/create -- Create a balance recharge order on lumos-web.
 *
 * Payment authority lives on lumos-web because it owns payment callbacks and
 * new-api quota writes. Desktop only forwards the logged-in web session.
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('lumos_session')?.value;
    if (!token) {
      return NextResponse.json(
        { success: false, message: '请先登录' },
        { status: 401 },
      );
    }

    const user = await getUserBySession(token);
    if (!user) {
      return NextResponse.json(
        { success: false, message: '会话已过期，请重新登录' },
        { status: 401 },
      );
    }

    const { amountYuan, payType } = await req.json();
    if (!amountYuan || !payType) {
      return NextResponse.json(
        { success: false, message: '缺少支付参数' },
        { status: 400 },
      );
    }

    const row = getDb()
      .prepare('SELECT web_session_token FROM lumos_users WHERE id = ?')
      .get(user.id) as { web_session_token: string } | undefined;
    const webToken = row?.web_session_token || '';
    if (!webToken) {
      return NextResponse.json(
        { success: false, message: '未登录 Lumos 云账户，无法创建充值订单' },
        { status: 401 },
      );
    }

    const webBase = process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';
    const upstream = await fetch(`${webBase}/api/payment/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${webToken}`,
      },
      body: JSON.stringify({ amountYuan, payType }),
      cache: 'no-store',
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data?.success) {
      return NextResponse.json(
        {
          success: false,
          message: data?.message || data?.error || `创建充值订单失败：HTTP ${upstream.status}`,
        },
        { status: upstream.status || 400 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : '创建订单失败';
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
