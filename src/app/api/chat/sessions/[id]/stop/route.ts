// 停止会话当前执行(中断 SDK 会话 + 兜底清锁)。逻辑在 @/lib/chat/session-stop。

import { NextRequest } from 'next/server';
import { getSession } from '@/lib/db';
import { stopSessionRun } from '@/lib/chat/session-stop';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSession(id)) return Response.json({ error: 'Session not found' }, { status: 404 });
  const result = await stopSessionRun(id);
  return Response.json(result);
}
