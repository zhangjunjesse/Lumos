import { NextRequest, NextResponse } from 'next/server';

import { getEcommerceStore } from '@/lib/ecommerce-assistant/storage';
import type { StylePresetRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as Partial<StylePresetRecord>;
    const store = getEcommerceStore();
    const negativeRules =
      typeof body.negative_rules === 'string'
        ? body.negative_rules
        : Array.isArray(body.negative_rules)
          ? JSON.stringify(body.negative_rules)
          : undefined;
    const updated = store.update<StylePresetRecord>('style_presets', id, {
      name: body.name,
      direction: body.direction,
      scene: body.scene ?? null,
      composition: body.composition ?? null,
      lighting: body.lighting ?? null,
      mood: body.mood ?? null,
      ...(negativeRules !== undefined ? { negative_rules: negativeRules } : {}),
      enabled: body.enabled,
    });
    if (!updated) return NextResponse.json({ error: '预设不存在。' }, { status: 404 });
    return NextResponse.json({ preset: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    const existing = store.get<StylePresetRecord>('style_presets', id);
    if (!existing) return NextResponse.json({ error: '预设不存在。' }, { status: 404 });
    if (existing.is_builtin) {
      return NextResponse.json(
        { error: '内置预设不可删除，可点击「禁用」停用。' },
        { status: 400 },
      );
    }
    store.delete('style_presets', id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
