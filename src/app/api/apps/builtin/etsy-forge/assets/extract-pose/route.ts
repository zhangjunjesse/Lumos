// 一键抠模特姿势（异步）：把选中商品标为 pose_status=running 后立即返回，后台逐张抠(慢)，
// 跑完更新各商品 pose_status。前端轮询 pose_status 看进度，不阻塞 UI。

import { NextRequest, NextResponse } from 'next/server';
import { runPoseExtract } from '@/lib/etsy-forge/pose-extract';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ProductRow } from '@/lib/etsy-forge/types';
import { getImageConcurrency, mapLimit } from '@/lib/etsy-forge/concurrency';

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

    for (const pid of productIds) {
      const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, pid);
      if (p && p.user_id === userId) store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, { pose_status: 'running' });
    }

    // fire-and-forget：常驻进程，请求返回后继续在进程内跑；商品间有限并发(并发度来自设置)。
    void (async () => {
      await mapLimit(productIds, getImageConcurrency(store), async (pid) => {
        try {
          const r = await runPoseExtract(store, { userId, productId: pid, imageIds });
          store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, {
            pose_status: r.created > 0 ? (r.failed > 0 ? 'partial' : 'success') : 'failed',
          });
        } catch {
          store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, { pose_status: 'failed' });
        }
      });
    })();

    return NextResponse.json({ ok: true, started: productIds.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
