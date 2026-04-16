import { NextRequest, NextResponse } from 'next/server';
import {
  buildDebugSessionSnapshot,
  clearDebugSessionForWorkflow,
} from '@/lib/workflow/debug-runner';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const snapshot = buildDebugSessionSnapshot(id);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载调试会话失败';
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    clearDebugSessionForWorkflow(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '清空调试会话失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
