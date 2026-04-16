import { NextRequest, NextResponse } from 'next/server';
import { runDebugWorkflow } from '@/lib/workflow/debug-runner';
import type { DebugRunRequest } from '@/lib/workflow/debug-types';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json() as Partial<DebugRunRequest>;

  if (!body.mode || !['run-to', 'rerun-only', 'continue-from'].includes(body.mode)) {
    return NextResponse.json({ error: '缺少或无效的 mode' }, { status: 400 });
  }
  if (!body.targetStepId?.trim()) {
    return NextResponse.json({ error: 'targetStepId 不能为空' }, { status: 400 });
  }

  try {
    const result = await runDebugWorkflow({
      workflowId: id,
      mode: body.mode,
      targetStepId: body.targetStepId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '调试运行失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
