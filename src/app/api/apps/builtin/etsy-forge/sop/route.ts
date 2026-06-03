// SOP「一键出品」:POST 启动(同步建 run、后台跑链)、GET 列运行(可带 run_id 拿该 run 的分步状态)。
// 前置(选中商品/图片服务商)同步校验、错误立即报;执行 fire-and-forget,前端轮询 GET 看进度。

import { NextRequest, NextResponse } from 'next/server';
import { createSopRun, executeSopRun } from '@/lib/etsy-forge/sop/engine';
import { SOP_STEPS } from '@/lib/etsy-forge/sop/defs';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type SopRunRow, type SopStepRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_ids?: string[]; directions?: string[] };
    const productIds = (body.product_ids ?? []).filter(Boolean);
    if (productIds.length === 0) return NextResponse.json({ error: '请先选中商品' }, { status: 400 });
    const directions = (Array.isArray(body.directions) ? body.directions : []).filter((d): d is 'A' | 'B' | 'C' | 'D' =>
      ['A', 'B', 'C', 'D'].includes(d),
    );

    const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
    if (!provider) return NextResponse.json({ error: '未配置图片服务商(去「设置 → 图片生成」选一个)' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const { runId } = createSopRun(store, { userId, productIds, directions: directions.length ? directions : undefined });
    // fire-and-forget:整条链很慢(每商品 7 步、含多次图片生成),请求秒返回,前端轮询 GET 看进度。
    void executeSopRun(store, userId, runId).catch(() => {});
    return NextResponse.json({ ok: true, runId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const runId = req.nextUrl.searchParams.get('run_id');

    if (runId) {
      const run = store.get<SopRunRow>(COLLECTIONS.SOP_RUNS, runId);
      if (!run || run.user_id !== userId) return NextResponse.json({ error: '运行不存在' }, { status: 404 });
      const steps = store.query<SopStepRow>(COLLECTIONS.SOP_STEPS, { filter: { run_id: runId }, limit: 5000 });
      return NextResponse.json({ run, steps, stepDefs: SOP_STEPS });
    }

    const runs = store.query<SopRunRow>(COLLECTIONS.SOP_RUNS, {
      filter: { user_id: userId },
      orderBy: { field: 'started_at', direction: 'desc' },
      limit: 50,
    });
    return NextResponse.json({ runs, stepDefs: SOP_STEPS });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
