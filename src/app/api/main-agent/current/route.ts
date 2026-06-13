import { resolveMainAgentSession } from '@/lib/chat/main-agent-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 返回「此刻主 Agent 应运行的当日会话」id —— 跟页面入口、cron tick 同一个幂等切日点。
// 已打开的主 Agent 页面用它检测跨睡眠日切换：发现 id 变了就接管到新会话。
export async function GET() {
  try {
    const session = resolveMainAgentSession({ createIfMissing: true });
    return Response.json({ sessionId: session?.id || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/main-agent/current] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
