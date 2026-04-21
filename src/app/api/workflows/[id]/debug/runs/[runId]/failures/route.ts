import { NextRequest, NextResponse } from 'next/server';
import { getDebugRunFailures } from '@/lib/workflow/debug-runner';

type Params = { params: Promise<{ id: string; runId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { runId } = await params;
  try {
    const report = getDebugRunFailures(runId);
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载失败详情失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
