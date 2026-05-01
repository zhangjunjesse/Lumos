/**
 * GET /api/im/wechat/route
 *
 * 返回当前微信路由目标 session id（只读）。
 * lumos UI 用它在 session 顶部显示 📨 标记。
 */

import { NextResponse } from 'next/server';
import { getCurrentRoutedSessionId } from '@/lib/im/providers/wechat/route-pointer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ sessionId: getCurrentRoutedSessionId() });
}
