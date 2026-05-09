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
    const updated = store.update<ProductInputRecord>('product_inputs', id, {
      title: body.title,
      category_hint: body.category_hint ?? null,
      note: body.note ?? null,
      status: body.status ?? undefined,
    });
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
