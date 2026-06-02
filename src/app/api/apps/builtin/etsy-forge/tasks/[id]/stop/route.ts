// 停止一个正在跑的列表采集任务。翻「要停」旗,collector 翻完手头这页就收手、已爬到的照常入库、终态记 cancelled。
// 若进程内没有活动 run 但 DB 仍显示 running(多为进程重启残留),直接按残留收尾标 cancelled。

import { NextRequest, NextResponse } from 'next/server';
import { finishTask, getTask } from '@/lib/etsy-forge/collection-task';
import { requestAbort } from '@/lib/etsy-forge/run-registry';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getEtsyForgeStore();
    const task = getTask(store, id);
    if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });
    if (task.user_id !== getStorageUserId(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // 命中进程内活动 run → 翻旗,collector 下个翻页边界(约 20s 内)收手并写终态。
    if (requestAbort(id)) {
      return NextResponse.json({ ok: true, stopping: true });
    }

    // 没有活动 run:DB 仍 running 属残留,直接收尾(不增计数,只翻状态)。
    if (task.last_status === 'running') {
      finishTask(store, id, {
        status: 'cancelled',
        collectedCount: 0,
        failureReason: '已停止（无活动运行，按残留状态收尾）',
        runId: task.last_run_id,
      });
      return NextResponse.json({ ok: true, stopping: false, recovered: true });
    }

    return NextResponse.json({ ok: true, stopping: false }); // 本就没在跑
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
