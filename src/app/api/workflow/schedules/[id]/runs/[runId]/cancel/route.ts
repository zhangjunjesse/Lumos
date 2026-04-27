import { NextRequest, NextResponse } from 'next/server';
import { cancelScheduleRun } from '@/lib/workflow/schedule-run-control';

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id, runId } = await context.params;
    const body = await request.json().catch(() => ({})) as { reason?: string };
    const result = await cancelScheduleRun(
      runId,
      id,
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : '用户从执行记录页停止任务',
    );

    if (!result.cancelled && result.message === '执行记录不存在') {
      return NextResponse.json({ error: result.message }, { status: 404 });
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '取消执行失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
