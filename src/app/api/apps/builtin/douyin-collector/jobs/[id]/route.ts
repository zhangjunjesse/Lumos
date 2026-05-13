import { NextRequest, NextResponse } from 'next/server';

import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';
import { COLLECTION_JOBS } from '@/lib/douyin-collector/constants';
import { markJobStatus, runJob } from '@/lib/douyin-collector/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? '';
    if (action === 'cancel') {
      const updated = markJobStatus(id, {
        status: 'cancelled',
        failureReason: '用户手动取消。',
      });
      if (!updated) return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
      return NextResponse.json({ job: updated });
    }
    if (action === 'retry') {
      const job = await runJob(id);
      if (!job) return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
      return NextResponse.json({ job });
    }
    return NextResponse.json({ error: 'action 必须是 cancel 或 retry。' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const store = getDouyinCollectorStore();
    const ok = store.delete(COLLECTION_JOBS, id);
    if (!ok) return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
