// SOP 单步重试:从指定步起重跑该商品后续链(失败可续)。执行 fire-and-forget,前端轮询看进度。

import { NextRequest, NextResponse } from 'next/server';
import { retryStep } from '@/lib/etsy-forge/sop/engine';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type SopRunRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { run_id?: string; product_id?: string; step_key?: string };
    const runId = (body.run_id ?? '').trim();
    const productId = (body.product_id ?? '').trim();
    const stepKey = (body.step_key ?? '').trim();
    if (!runId || !productId || !stepKey) return NextResponse.json({ error: 'run_id / product_id / step_key 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const run = store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId);
    if (!run || run.user_id !== userId) return NextResponse.json({ error: '运行不存在' }, { status: 404 });

    void retryStep(store, { userId, runId, productId, stepKey }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
