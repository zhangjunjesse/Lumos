import { NextRequest, NextResponse } from 'next/server';

import {
  getCandidate,
  getEcommerceStore,
  listCandidates,
  patchCandidate,
} from '@/lib/ecommerce-assistant/storage';
import { isProtectedPromoted } from '@/lib/ecommerce-assistant/discover-lifecycle';
import { deleteSelectionEvidenceByResearchId } from '@/lib/ecommerce-assistant/discover-evidence-storage';
import type { DiscoverCandidateRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    const candidate = getCandidate(store, id);
    if (!candidate) return NextResponse.json({ error: '候选不存在。' }, { status: 404 });
    return NextResponse.json({ candidate });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * Inline-edit a discover candidate. Only user-editable fields are honored.
 * Promoted candidates can still be lightly edited (notes), but the linked
 * product_input is NOT auto-synced — the user must update that separately
 * to avoid silent overwrites of in-flight image jobs.
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
    const patch: Partial<DiscoverCandidateRecord> = {};
    if (typeof body?.product_name === 'string') patch.product_name = body.product_name.trim();
    if (typeof body?.category === 'string') patch.category = body.category.trim();
    if (typeof body?.summary === 'string') patch.summary = body.summary;
    if (typeof body?.differentiation === 'string') patch.differentiation = body.differentiation;
    if (
      typeof body?.estimated_price_usd === 'number' &&
      Number.isFinite(body.estimated_price_usd)
    ) {
      patch.estimated_price_usd = body.estimated_price_usd;
    }
    if (Array.isArray(body?.selling_points)) {
      patch.selling_points = JSON.stringify(
        (body!.selling_points as unknown[]).map((s) => String(s)).filter(Boolean),
      );
    }
    if (Array.isArray(body?.risks)) {
      patch.risks = JSON.stringify(
        (body!.risks as unknown[]).map((s) => String(s)).filter(Boolean),
      );
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '没有可保存的字段。' }, { status: 400 });
    }
    const updated = patchCandidate(store, id, patch);
    if (!updated) return NextResponse.json({ error: '候选不存在。' }, { status: 404 });
    return NextResponse.json({ candidate: updated });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    const candidate = getCandidate(store, id);
    if (!candidate) return NextResponse.json({ error: '候选不存在。' }, { status: 404 });
    if (isProtectedPromoted(store, candidate)) {
      return NextResponse.json(
        {
          error:
            '候选已转入工坊（promoted）且下游 product_input 仍在，不能直接删除——会切断流水线追溯。请先在工坊归档对应的 product_input。',
        },
        { status: 409 },
      );
    }
    const ok = store.delete('discover_candidates', id);
    if (!ok) return NextResponse.json({ error: '候选不存在。' }, { status: 404 });
    if (
      candidate.research_id &&
      listCandidates(store, { research_id: candidate.research_id }).length === 0
    ) {
      deleteSelectionEvidenceByResearchId(store, candidate.research_id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
