import { NextRequest, NextResponse } from 'next/server';
import { getScheduleRunDetail } from '@/lib/workflow/schedule-run-detail';

interface RouteContext {
  params: Promise<{ runId: string }>;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const scheduleId = request.nextUrl.searchParams.get('scheduleId')?.trim() || undefined;
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
