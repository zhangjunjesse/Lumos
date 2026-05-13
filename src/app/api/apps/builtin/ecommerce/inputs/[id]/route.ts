import { NextRequest, NextResponse } from 'next/server';

import { getEcommerceStore, getInput } from '@/lib/ecommerce-assistant/storage';
import type { ProductInputRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    const item = getInput(store, id);
    if (!item) return NextResponse.json({ error: '商品输入不存在。' }, { status: 404 });
    return NextResponse.json({ input: item });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as Partial<ProductInputRecord>;
    const store = getEcommerceStore();
    const patch: Partial<ProductInputRecord> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.category_hint !== undefined) patch.category_hint = body.category_hint;
    if (body.note !== undefined) patch.note = body.note;
    if (body.status !== undefined) patch.status = body.status;
    if (body.main_image_path !== undefined) patch.main_image_path = body.main_image_path;
    const updated = store.update<ProductInputRecord>('product_inputs', id, patch);
    if (!updated) return NextResponse.json({ error: '商品输入不存在。' }, { status: 404 });
    return NextResponse.json({ input: updated });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    const ok = store.delete('product_inputs', id);
    if (!ok) return NextResponse.json({ error: '商品输入不存在。' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
