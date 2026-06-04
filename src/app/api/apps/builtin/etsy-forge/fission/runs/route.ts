// 裂变·活跃运行:GET 列出正在跑(running)的裂变运行,供原图卡片显示「裂变中」。
// 只返回近 15 分钟内的 running(防进程崩溃留下永久 stale 状态)。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type FissionRunRow, type ManualProductRow, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STALE_MS = 15 * 60 * 1000;
const STAGE_CN: Record<string, string> = { preview: '预览', finalize: '定稿', iterate: '迭代' };

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const cutoff = Date.now() - STALE_MS;
    const rows = store
      .query<FissionRunRow>(COLLECTIONS.FISSION_RUNS, { filter: { user_id: userId, status: 'running' }, limit: 200 })
      .filter((r) => new Date(r.created_at).getTime() >= cutoff);
    const titleOf = (pid: string): string => {
      if (!pid) return '灵感'; // 无产品 = 灵感目标
      const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, pid);
      if (p?.title) return p.title;
      const m = store.get<ManualProductRow>(COLLECTIONS.MANUAL_PRODUCTS, pid);
      return m?.name ?? '产品';
    };
    return NextResponse.json({
      runs: rows.map((r) => ({
        run_id: r.run_id,
        base_asset_id: r.base_asset_id,
        product_id: r.product_id,
        title: titleOf(r.product_id),
        stage: r.stage,
        stage_cn: STAGE_CN[r.stage] ?? r.stage,
        expected: r.expected,
        started_at: r.created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
