import { NextRequest, NextResponse } from 'next/server';
import { loginUser, getUserBySession, refreshUserBalance } from '@/lib/auth/user-service';
import { destroySession } from '@/lib/auth/session';

const SESSION_MAX_AGE = 2592000; // 30 days

/** GET /api/cloud-auth -- current user (legacy compat) */
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('lumos_session')?.value;
    if (!token) return NextResponse.json({ success: false, message: '未登录' });

    const user = await getUserBySession(token);
    if (!user) return NextResponse.json({ success: false, message: '会话已过期' });

    const balance = await refreshUserBalance(user.id).catch(() => null);
    return NextResponse.json({ success: true, data: mapToLegacyFormat(user, balance) });
  } catch {
    return NextResponse.json({ success: false, message: '获取用户信息失败' });
  }
}

/** POST /api/cloud-auth -- login (legacy compat, accepts username or email) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = body.email || body.username;
    const { password } = body;
    if (!email || !password) {
      return NextResponse.json({ success: false, message: '请输入用户名和密码' }, { status: 400 });
    }

    const result = await loginUser(email, password);
    const res = NextResponse.json({ success: true, data: { user: result.user } });
    res.cookies.set('lumos_session', result.token, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : '登录失败';
    return NextResponse.json({ success: false, message }, { status: 401 });
  }
}

/** DELETE /api/cloud-auth -- logout */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get('lumos_session')?.value;
  if (token) { try { destroySession(token); } catch { /* ignore */ } }

  const res = NextResponse.json({ success: true, message: '已退出' });
  res.cookies.delete('lumos_session');
  return res;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapToLegacyFormat(user: any, balance: any) {
  return {
    id: user.id,
    username: user.email,
    display_name: user.nickname || user.email,
    quota: balance?.remainQuota ?? 0,
    used_quota: balance?.usedQuota ?? 0,
    group: user.membership ?? 'default',
  };
}
