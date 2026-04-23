import { NextRequest, NextResponse } from 'next/server';
import {
  getUserBySession,
  refreshUserBalance,
} from '@/lib/auth/user-service';
import { getCustomProviderFlags } from '@/lib/edition-runtime';

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
      data: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        membership: user.membership,
        membership_expires_at: user.membership_expires_at,
        role: user.role || 'user',
        balance: remainQuota,
        used_quota: usedQuota,
        balance_error: balanceError,
        allow_custom_providers: getCustomProviderFlags(),
        // backward compat fields
        username: user.email,
        display_name: user.nickname || user.email,
        quota: remainQuota,
        group: user.membership,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取用户信息失败';
    return NextResponse.json({ success: false, message });
  }
}
