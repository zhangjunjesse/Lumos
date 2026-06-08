// 「我的产品」按方向出图:选 1 个二创方向 → 取该商品印花、按方向改图 + 印到 T → 出 1 张产品图(挂到该商品下,新增)。
// 快速校验(商品/方向/服务商)同步报错;生成 fire-and-forget,前端轮询 listMockups 看新图。

import { NextRequest, NextResponse } from 'next/server';
import { runDirectionMockup } from '@/lib/etsy-forge/composer';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ManualProductRow, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_id?: string; direction?: string; base_ref?: string };
    const productId = (body.product_id ?? '').trim();
    const direction = (body.direction ?? '').trim();
    const baseRef = (body.base_ref ?? '').trim() || undefined; // 用户选的底图(印花/已生成产品图);不传=默认原始印花
    if (!productId) return NextResponse.json({ error: 'product_id 必填' }, { status: 400 });
    if (!direction) return NextResponse.json({ error: '请选择一个二创方向' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    // 采集商品或手攒产品都可,只校验归属。
    const isCollected = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId)?.user_id === userId;
    const isManual = store.get<ManualProductRow>(COLLECTIONS.MANUAL_PRODUCTS, productId)?.user_id === userId;
    if (!isCollected && !isManual) return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
      return NextResponse.json({ error: '未配置图片服务商(去「设置 → 图片生成」选一个)' }, { status: 400 });
    }

    void runDirectionMockup(store, { userId, productId, directionCode: direction, baseRef }).catch(() => {});
    return NextResponse.json({ ok: true, started: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
