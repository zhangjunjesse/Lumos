import { NextRequest, NextResponse } from 'next/server';
import {
  getUserBySession,
  refreshUserBalance,
} from '@/lib/auth/user-service';
import { getCustomProviderFlags } from '@/lib/edition-runtime';
import { composeAuthPayload } from '@/lib/auth/payload';

/**
 * GET /api/auth/me  -- Get current authenticated user
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('lumos_session')?.value;
    if (!token) {
      return NextResponse.json({ success: false, message: '未登录' });
    }

    const user = getUserBySession(token);
    if (!user) {
      return NextResponse.json({ success: false, message: '会话已过期' });
    }

    let remainQuota = 0;
    let usedQuota = 0;
    let balanceError: string | undefined;
    try {
      const balance = await refreshUserBalance(user.id);
      remainQuota = balance.remainQuota;
      usedQuota = balance.usedQuota;
    } catch (e) {
      balanceError = e instanceof Error ? e.message : String(e);
      console.warn('[auth/me] refreshUserBalance failed:', balanceError);
    }

    return NextResponse.json({
      success: true,
      data: composeAuthPayload(user, remainQuota, usedQuota, getCustomProviderFlags(), balanceError),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取用户信息失败';
    return NextResponse.json({ success: false, message });
  }
}
