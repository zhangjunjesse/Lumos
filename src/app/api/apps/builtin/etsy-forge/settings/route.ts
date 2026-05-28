// /api/apps/builtin/etsy-forge/settings
// GET: 读应用设置（浏览器上下文 + AI 标注开关）
// PUT: 更新（browser_context_id 趋势抓取接通后才生效）

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';
import { COLLECTIONS } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_BROWSER_CONTEXT = 'embedded:default';

export async function GET() {
  try {
    const store = getEtsyForgeStore();
    const row = store.query<{ browser_context_id?: string; auto_tag_ai_generated?: boolean }>(
      COLLECTIONS.APP_SETTINGS,
      { limit: 1 },
    )[0];
    return NextResponse.json({
      browser_context_id: row?.browser_context_id ?? DEFAULT_BROWSER_CONTEXT,
      auto_tag_ai_generated: row?.auto_tag_ai_generated ?? true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      browser_context_id?: string;
      auto_tag_ai_generated?: boolean;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.browser_context_id === 'string') patch.browser_context_id = body.browser_context_id;
    if (typeof body.auto_tag_ai_generated === 'boolean') patch.auto_tag_ai_generated = body.auto_tag_ai_generated;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    }

    const store = getEtsyForgeStore();
    const row = store.query<{ id: string }>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];
    if (row) {
      store.update(COLLECTIONS.APP_SETTINGS, row.id, patch);
    } else {
      store.create(COLLECTIONS.APP_SETTINGS, patch);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
