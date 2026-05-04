import { NextRequest, NextResponse } from 'next/server';
import { rerunScheduleRunFromNode } from '@/lib/workflow/schedule-run-rerun';

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: scheduleId, runId } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      mode?: 'from-failed' | 'from-step';
      stepId?: string;
    };

    const result = await rerunScheduleRunFromNode({
      scheduleId,
      runId,
      mode: body.mode === 'from-step' ? 'from-step' : 'from-failed',
      stepId: body.stepId,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '重跑失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
