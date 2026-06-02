// 立即跑一个关键词任务的列表采集（爬 Etsy 搜索页 → 商品入库）。同步等结果。

import { NextRequest, NextResponse } from 'next/server';
import { getTask } from '@/lib/etsy-forge/collection-task';
import { runListCollect } from '@/lib/etsy-forge/list-collect';
import { registerRun, unregisterRun, isAbortRequested } from '@/lib/etsy-forge/run-registry';
import { getBrowserContextId, getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { max_products?: number };

    const store = getEtsyForgeStore();
    const task = getTask(store, id);
    if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });
    if (task.user_id !== getStorageUserId(req)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (task.last_status === 'running') {
      return NextResponse.json({ error: '任务正在运行中，请稍候' }, { status: 409 });
    }

    const maxProductsOverride =
      typeof body.max_products === 'number' && body.max_products >= 1 && body.max_products <= 48
        ? Math.floor(body.max_products)
        : undefined;

    registerRun(task.id);
    try {
      const result = await runListCollect(store, task, {
        browserContextId: getBrowserContextId(store),
        maxProductsOverride,
        isAborted: () => isAbortRequested(task.id),
      });
      return NextResponse.json(result);
    } finally {
      unregisterRun(task.id);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
