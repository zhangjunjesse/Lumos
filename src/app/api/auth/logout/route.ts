import { NextRequest, NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth/session';

/**
 * DELETE /api/auth/logout  -- Destroy session and clear cookie
 */
export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get('lumos_session')?.value;
    if (token) {
      await destroySession(token);
    }

    const res = NextResponse.json({ success: true });
    res.cookies.delete('lumos_session');
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : '退出失败';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
