import { NextRequest, NextResponse } from 'next/server';
import {
  getUserBySession,
  refreshUserBalance,
} from '@/lib/auth/user-service';

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

    const balance = await refreshUserBalance(user.id).catch(() => ({
      remainQuota: 0,
      usedQuota: 0,
    }));

    return NextResponse.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        membership: user.membership,
        membership_expires_at: user.membership_expires_at,
        image_quota_monthly: user.image_quota_monthly,
        role: user.role || 'user',
        balance: balance.remainQuota,
        used_quota: balance.usedQuota,
        // backward compat fields
        username: user.email,
        display_name: user.nickname || user.email,
        quota: balance.remainQuota,
        group: user.membership,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取用户信息失败';
    return NextResponse.json({ success: false, message });
  }
}
