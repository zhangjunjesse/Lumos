// ⑤ 自动二创:对一个商品基于抠出的印花+标题/卖点生成 ~5 个变体印花。
// 前置(商品/印花/服务商)同步校验、错误立即报;生成 fire-and-forget,前端轮询「我的图库→二创」看。

import { NextRequest, NextResponse } from 'next/server';
import { runRemix } from '@/lib/etsy-forge/remix';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type CutoutRow, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_id?: string; directions?: string[] };
    const productId = (body.product_id ?? '').trim();
    if (!productId) return NextResponse.json({ error: 'product_id 必填' }, { status: 400 });
    const directions = (Array.isArray(body.directions) ? body.directions : []).filter((d): d is string => typeof d === 'string' && !!d);

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId);
    if (!product || product.user_id !== userId) return NextResponse.json({ error: '商品不存在' }, { status: 404 });

    const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
    if (!provider) return NextResponse.json({ error: '未配置图片服务商(去「设置 → 图片生成」选一个)' }, { status: 400 });

    const cutout = store.query<CutoutRow>(COLLECTIONS.CUTOUTS, { filter: { product_id: productId, status: 'success' }, limit: 1 })[0];
    if (!cutout) return NextResponse.json({ error: '该商品还没有抠出的印花,先「抠印花」再二创' }, { status: 400 });

    // fire-and-forget:5 张二创慢,请求秒返回,后台跑完落库(assets/remix),前端轮询「我的图库」看。
    void runRemix(store, { userId, productId, directions: directions.length ? directions : undefined }).catch(() => {});
    return NextResponse.json({ ok: true, started: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
