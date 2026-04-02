import { NextRequest, NextResponse } from 'next/server';
import { triggerSchedule } from '@/lib/scheduler/cron-engine';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { params?: Record<string, unknown> };
    await triggerSchedule(id, body.params);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '触发失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
