import { NextRequest, NextResponse } from 'next/server';
import { sendVerificationCode } from '@/lib/auth/email';

/**
 * POST /api/auth/send-code  -- Send email verification code
 */
export async function POST(req: NextRequest) {
  try {
    const { email, purpose = 'register' } = await req.json();
    if (!email) {
      return NextResponse.json(
        { success: false, message: '请输入邮箱地址' },
        { status: 400 },
      );
    }

    await sendVerificationCode(email, purpose);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '发送验证码失败';
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
