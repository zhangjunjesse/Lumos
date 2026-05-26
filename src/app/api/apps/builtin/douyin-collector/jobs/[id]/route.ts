import { NextRequest, NextResponse } from 'next/server';

import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';
import type { CollectJobRecord } from '@/lib/douyin-collector/types';
import { COLLECTION_JOBS, DOUYIN_COLLECTOR_APP_ID } from '@/lib/douyin-collector/constants';
import { markJobStatus, runJob } from '@/lib/douyin-collector/jobs';
import { markRunCancelled } from '@/lib/app/runtime/run-control';
import { describeJobProgress, getJobProgress } from '@/lib/douyin-collector/job-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live job status + progress projection. Polled by the douyin_job_status
 * MCP tool so the AI can narrate "正在处理 3/20、已入库 2" while a
 * fire-and-forget job (POST /jobs → void runJob) is still running.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const job = getDouyinCollectorStore().get<CollectJobRecord>(COLLECTION_JOBS, id);
    if (!job) return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
    const progress = getJobProgress(id);
    return NextResponse.json({
      job,
      progress,
      progress_text: progress ? describeJobProgress(progress) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? '';
    if (action === 'cancel') {
      // 先 markRunCancelled: worker 循环顶部会 check 后立即退出, 不再发新
      // 请求/打开新 tab。再标 db 状态 cancelled, UI 立刻看到终态。worker 可能
      // 卡在 await 中(协作式取消窗口期), 终态后 runJob finally 会清理 flag。
      markRunCancelled(DOUYIN_COLLECTOR_APP_ID, id);
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
