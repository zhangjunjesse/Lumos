// 详情图分类(②b):POST 对一个商品的详情图 AI 分类(同步,逐图有限并发);PATCH 人工纠正单张类型。

import { NextRequest, NextResponse } from 'next/server';
import { classifyImages } from '@/lib/etsy-forge/classify-image';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type DetailImageRow, type ImageType } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: ImageType[] = ['model_scene', 'product', 'size', 'color', 'other'];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_id?: string };
    const productId = (body.product_id ?? '').trim();
    if (!productId) return NextResponse.json({ error: 'product_id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    const r = await classifyImages(store, { userId: getStorageUserId(req), productId });
    if (!r.ok && r.error) return NextResponse.json({ error: r.error }, { status: 500 });
    return NextResponse.json({ ok: true, classified: r.classified, failed: r.failed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { image_id?: string; image_type?: string };
    const id = (body.image_id ?? '').trim();
    const type = body.image_type as ImageType;
    if (!id || !VALID_TYPES.includes(type)) return NextResponse.json({ error: '参数无效' }, { status: 400 });
    const store = getEtsyForgeStore();
    const row = store.get<DetailImageRow>(COLLECTIONS.IMAGES, id);
    if (!row || row.user_id !== getStorageUserId(req)) return NextResponse.json({ error: '图不存在' }, { status: 404 });
    store.update<DetailImageRow>(COLLECTIONS.IMAGES, id, { image_type: type });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
