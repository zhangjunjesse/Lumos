// Step11 系列化:对一张达标的二创印花(母版)扩展出 5-10 张同系列新印花。
// 前置(商品/母版/服务商)同步校验、错误立即报;生成 fire-and-forget,前端轮询「我的图库→二创」看。

import { NextRequest, NextResponse } from 'next/server';
import { runRemixSeries } from '@/lib/etsy-forge/remix-series';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type AssetRow, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_id?: string; base_asset_id?: string; count?: number };
    const productId = (body.product_id ?? '').trim();
    const baseAssetId = (body.base_asset_id ?? '').trim();
    if (!productId || !baseAssetId) return NextResponse.json({ error: 'product_id 和 base_asset_id 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId);
    if (!product || product.user_id !== userId) return NextResponse.json({ error: '商品不存在' }, { status: 404 });

    const base = store.get<AssetRow>(COLLECTIONS.ASSETS, baseAssetId);
    if (!base || base.user_id !== userId || base.category !== 'remix') return NextResponse.json({ error: '母版二创印花不存在' }, { status: 404 });
    if (base.quality_flag === 'weak') return NextResponse.json({ error: '该图未达标(质检 weak),请先迭代再系列化' }, { status: 400 });

    const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
    if (!provider) return NextResponse.json({ error: '未配置图片服务商(去「设置 → 图片生成」选一个)' }, { status: 400 });

    void runRemixSeries(store, { userId, productId, baseAssetId, count: body.count }).catch(() => {});
    return NextResponse.json({ ok: true, started: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
