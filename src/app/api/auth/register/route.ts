import { NextRequest, NextResponse } from 'next/server';
import { registerUser } from '@/lib/auth/user-service';

const SESSION_MAX_AGE = 2592000; // 30 days

/**
 * POST /api/auth/register  -- Register new user with email + code
 */
export async function POST(req: NextRequest) {
  try {
    const { email, code, password, nickname } = await req.json();
    if (!email || !code || !password) {
      return NextResponse.json(
        { success: false, message: '请填写完整注册信息' },
        { status: 400 },
      );
    }

    const result = await registerUser({ email, code, password, nickname });

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
    const message = err instanceof Error ? err.message : '注册失败';
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
