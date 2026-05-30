// 一键分析素材（异步）：把选中商品标为 running 后立即返回，后台串行跑(看图慢/生成慢)，
// 跑完更新各商品 asset_status。前端轮询 asset_status 看进度，不阻塞 UI。

import { NextRequest, NextResponse } from 'next/server';
import { runAnalyzeAssets } from '@/lib/etsy-forge/asset-analyze';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_ids?: string[]; image_ids?: string[] };
    const productIds = Array.isArray(body.product_ids) ? body.product_ids.filter((x) => typeof x === 'string') : [];
    const imageIds = Array.isArray(body.image_ids) ? body.image_ids.filter((x) => typeof x === 'string') : undefined;
    if (productIds.length === 0) return NextResponse.json({ error: 'product_ids 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);

    // 先把选中商品标为 running（前端轮询立刻能看到「分析中」），再后台串行跑。
    for (const pid of productIds) {
      const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, pid);
      if (p && p.user_id === userId) store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, { asset_status: 'running' });
    }

    // fire-and-forget：Electron/Next 常驻进程，请求返回后任务继续在进程内串行跑。
    void (async () => {
      for (const pid of productIds) {
        try {
          const r = await runAnalyzeAssets(store, { userId, productId: pid, imageIds });
          store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, {
            asset_status: r.created > 0 ? (r.failed > 0 ? 'partial' : 'success') : 'failed',
          });
        } catch {
          store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, { asset_status: 'failed' });
        }
      }
    })();

    return NextResponse.json({ ok: true, started: productIds.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
