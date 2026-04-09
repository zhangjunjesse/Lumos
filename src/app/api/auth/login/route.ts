import { NextRequest, NextResponse } from 'next/server';
import { loginUser } from '@/lib/auth/user-service';

const SESSION_MAX_AGE = 2592000; // 30 days

/**
 * POST /api/auth/login  -- Login with email + password
 */
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: '请输入账号和密码' },
        { status: 400 },
      );
    }

    const result = await loginUser(email, password);

    const res = NextResponse.json({
      success: true,
      data: { user: result.user },
    });
    res.cookies.set('lumos_session', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : '登录失败';
    return NextResponse.json({ success: false, message }, { status: 401 });
  }
}
