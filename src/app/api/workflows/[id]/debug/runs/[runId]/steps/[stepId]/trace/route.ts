import { NextRequest, NextResponse } from 'next/server';
import { getDebugStepTrace } from '@/lib/workflow/debug-step-trace';

type Params = { params: Promise<{ id: string; runId: string; stepId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { runId, stepId } = await params;
  try {
    const result = getDebugStepTrace(runId, stepId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载完整对话失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
