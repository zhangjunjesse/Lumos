import { NextRequest, NextResponse } from 'next/server';

import {
  getEcommerceStore,
  ensureBuiltinStylePresets,
} from '@/lib/ecommerce-assistant/storage';
import type { StylePresetRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const presets = store.query<StylePresetRecord>('style_presets', {
      orderBy: { field: 'is_builtin', direction: 'desc' },
      limit: 100,
    });
    return NextResponse.json({ presets });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<StylePresetRecord>;
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: '预设名称不能为空。' }, { status: 400 });
    const direction = (body.direction as StylePresetRecord['direction']) || 'custom';
    const negativeRules =
      typeof body.negative_rules === 'string'
        ? body.negative_rules
        : JSON.stringify(Array.isArray(body.negative_rules) ? body.negative_rules : []);
    const store = getEcommerceStore();
    const created = store.create<StylePresetRecord>('style_presets', {
      name,
      direction,
      scene: body.scene ?? null,
      composition: body.composition ?? null,
      lighting: body.lighting ?? null,
      mood: body.mood ?? null,
      negative_rules: negativeRules,
      is_builtin: false,
      enabled: body.enabled ?? true,
    });
    return NextResponse.json({ preset: created });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
