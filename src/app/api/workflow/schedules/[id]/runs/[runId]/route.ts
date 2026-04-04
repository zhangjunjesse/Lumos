import { NextRequest, NextResponse } from 'next/server';
import { getScheduleRunDetail } from '@/lib/workflow/schedule-run-detail';

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: scheduleId, runId } = await context.params;
    const detail = await getScheduleRunDetail(runId, scheduleId);
    if (!detail) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch run';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
