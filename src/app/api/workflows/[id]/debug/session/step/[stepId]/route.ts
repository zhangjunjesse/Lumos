import { NextRequest, NextResponse } from 'next/server';
import { deleteDebugStep, getDebugStepOutput } from '@/lib/workflow/debug-runner';

type Params = { params: Promise<{ id: string; stepId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id, stepId } = await params;
  try {
    const output = getDebugStepOutput(id, stepId);
    if (!output) return NextResponse.json({ error: '未找到缓存' }, { status: 404 });
    return NextResponse.json(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取缓存失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, stepId } = await params;
  const cascade = request.nextUrl.searchParams.get('cascade') === 'true';
  try {
    deleteDebugStep(id, stepId, cascade);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除步骤缓存失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
