/**
 * GET /api/im/wechat/route
 *
 * 返回微信入口当前进入的 Main Agent session id（只读）。
 * 旧 route-pointer 不再决定入站归属。
 */

import { NextResponse } from 'next/server';
import { resolveWechatMainAgentSession } from '@/lib/im/providers/wechat/main-agent-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ sessionId: resolveWechatMainAgentSession()?.id ?? null });
}
