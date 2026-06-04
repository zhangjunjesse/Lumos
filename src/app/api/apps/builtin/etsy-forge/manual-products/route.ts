// 手攒产品:GET 列出 / POST 新建(增加产品的占位行) / DELETE 删除(连带名下生成图)。

import { NextRequest, NextResponse } from 'next/server';
import { createManualProduct, listManualProducts, deleteManualProduct } from '@/lib/etsy-forge/manual-products';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const products = listManualProducts(store, getStorageUserId(req));
    return NextResponse.json({ products });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string };
    const store = getEtsyForgeStore();
    const product = createManualProduct(store, getStorageUserId(req), body.name ?? '');
    return NextResponse.json({ ok: true, product });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: deleteManualProduct(store, getStorageUserId(req), id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
