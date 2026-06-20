// 列出创作助手的隔离会话(按 marker 过滤),供多会话切换/删除用。
// 新建走 ../session(POST),删除走 /api/chat/sessions/[id](DELETE)。

import { NextResponse } from 'next/server';
import { getAllSessions } from '@/lib/db';
import { isIsolatedCreationSession } from '@/lib/chat/creation-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sessions = getAllSessions()
      .filter((s) => isIsolatedCreationSession(s) && s.status !== 'archived')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) // 新的在前
      .map((s) => ({ id: s.id, title: s.title, created_at: s.created_at, updated_at: s.updated_at }));
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
