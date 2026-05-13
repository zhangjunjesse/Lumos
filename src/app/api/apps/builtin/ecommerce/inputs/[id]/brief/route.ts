import { NextRequest, NextResponse } from 'next/server';

import {
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import { recordAuditEvent } from '@/lib/ecommerce-assistant/audit-log';
import type { ProductBriefRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    const briefs = store.query<ProductBriefRecord>('product_briefs', {
      filter: { input_id: id },
      limit: 1,
    });
    const brief = briefs[0] ?? null;
    return NextResponse.json({ brief });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * Inline-edit the product brief. Only the fields that meaningfully change
 * downstream listing generation are user-editable here:
 *   - product_type            (string, e.g. "16oz travel mug")
 *   - category_bucket         (string, e.g. "kitchen-drinkware")
 *   - size_class              ('small' | 'medium' | 'large')
 *   - recommended_aspect_ratio
 *   - core_selling_points     (string[] — JSON-stringified for storage)
 *   - target_audience         (string[])
 *   - avoid_elements          (string[])
 *
 * Editing the brief BUMPS confidence to 9 (user-curated > AI-identified)
 * and stamps an audit note in raw_brief.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown> | null;
  try {
    body = (await req.json()) as Record<string, unknown> | null;
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  try {
    const store = getEcommerceStore();
    const existing = store
      .query<ProductBriefRecord>('product_briefs', { filter: { input_id: id }, limit: 1 })
      .at(0);
    if (!existing) {
      return NextResponse.json(
        { error: '该输入还没有 brief。请先上传主图触发自动识别，或从选品 promote 自动合成。' },
        { status: 404 },
      );
    }
    const patch: Partial<ProductBriefRecord> = {};
    if (typeof body?.product_type === 'string') patch.product_type = body.product_type.trim() || null;
    if (typeof body?.category_bucket === 'string') {
      patch.category_bucket = body.category_bucket.trim() || null;
    }
    if (
      body?.size_class === 'small' ||
      body?.size_class === 'medium' ||
      body?.size_class === 'large'
    ) {
      patch.size_class = body.size_class;
    }
    if (typeof body?.recommended_aspect_ratio === 'string') {
      patch.recommended_aspect_ratio = body.recommended_aspect_ratio.trim() || null;
    }
    if (Array.isArray(body?.core_selling_points)) {
      patch.core_selling_points = JSON.stringify(
        (body!.core_selling_points as unknown[]).map((s) => String(s)).filter(Boolean),
      );
    }
    if (Array.isArray(body?.target_audience)) {
      patch.target_audience = JSON.stringify(
        (body!.target_audience as unknown[]).map((s) => String(s)).filter(Boolean),
      );
    }
    if (Array.isArray(body?.avoid_elements)) {
      patch.avoid_elements = JSON.stringify(
        (body!.avoid_elements as unknown[]).map((s) => String(s)).filter(Boolean),
      );
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '没有可保存的字段。' }, { status: 400 });
    }

    // user-curated brief beats anything AI did → confidence 9
    patch.confidence = 9;

    // audit note in raw_brief so debugging can tell who last touched it
    let rawObj: Record<string, unknown> = {};
    if (existing.raw_brief) {
      try {
        rawObj = JSON.parse(existing.raw_brief);
      } catch {
        rawObj = { previous_raw: existing.raw_brief };
      }
    }
    rawObj.last_user_edit_at = new Date().toISOString();
    rawObj.source = 'user-edited';
    patch.raw_brief = JSON.stringify(rawObj);

    const updated = store.update<ProductBriefRecord>('product_briefs', existing.id, patch);
    if (!updated) return NextResponse.json({ error: 'brief 不存在。' }, { status: 404 });
    recordAuditEvent(store, {
      kind: 'brief-edited',
      targetId: id,
      targetType: 'input',
      inputId: id,
      summary: `编辑 brief（${Object.keys(patch).filter((k) => k !== 'confidence' && k !== 'raw_brief').length} 个字段，confidence→9）`,
      payload: { changed_fields: Object.keys(patch) },
    });
    return NextResponse.json({ brief: updated });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
