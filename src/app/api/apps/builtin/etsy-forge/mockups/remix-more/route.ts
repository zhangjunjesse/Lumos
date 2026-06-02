// 「继续二创」:针对某原商品,选底图 + 写要求 → 图生图 → 存成该原商品的新产品图。
// 前置(商品/服务商/要求)同步校验、错误立即报;生成 fire-and-forget,前端轮询 listMockups 看新图。

import { NextRequest, NextResponse } from 'next/server';
import { runRemixMore } from '@/lib/etsy-forge/remix-more';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_id?: string; base_url?: string; instruction?: string };
    const productId = (body.product_id ?? '').trim();
    const baseUrl = (body.base_url ?? '').trim();
    const instruction = (body.instruction ?? '').trim();
    if (!productId || !baseUrl) return NextResponse.json({ error: 'product_id / base_url 必填' }, { status: 400 });
    if (!instruction) return NextResponse.json({ error: '请填写你的要求' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId);
    if (!product || product.user_id !== userId) return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
      return NextResponse.json({ error: '未配置图片服务商(去「设置 → 图片生成」选一个)' }, { status: 400 });
    }

    // 本地媒体的 serve url 服务端 fetch 不了,把 ?path= 抠成本地路径直接读;直链才走 fetch。
    let baseLocalPath: string | undefined;
    if (baseUrl.startsWith('/api/media/serve')) {
      try {
        baseLocalPath = new URL(baseUrl, 'http://localhost').searchParams.get('path') || undefined;
      } catch {
        /* 解析失败保留 url */
      }
    }

    void runRemixMore(store, { userId, productId, baseLocalPath, baseUrl, instruction }).catch(() => {});
    return NextResponse.json({ ok: true, started: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
