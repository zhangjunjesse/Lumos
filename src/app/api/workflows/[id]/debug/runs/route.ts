import { NextRequest, NextResponse } from 'next/server';
import { listDebugRuns } from '@/lib/db/scheduled-workflows';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const runs = listDebugRuns(id, 30);
    return NextResponse.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载调试历史失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
