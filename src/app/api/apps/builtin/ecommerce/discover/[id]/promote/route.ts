import { NextResponse } from 'next/server';

import {
  getEcommerceStore,
  ensureBuiltinStylePresets,
} from '@/lib/ecommerce-assistant/storage';
import {
  promoteCandidateToInput,
  DiscoverResearchError,
} from '@/lib/ecommerce-assistant/discover';
import { recordAuditEvent } from '@/lib/ecommerce-assistant/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// allow concept image generation to take up to ~60s
export const maxDuration = 90;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: '缺少候选 id。' }, { status: 400 });
    }
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    let result;
    try {
      result = await promoteCandidateToInput(store, id, ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
    recordAuditEvent(store, {
      kind: 'candidate-promoted',
      targetId: id,
      targetType: 'candidate',
      inputId: result.inputId,
      summary: `候选 promote → 工坊（${result.candidate.product_name}）${
        result.conceptImagePath ? '；附 AI 概念图' : '；概念图未生成'
      }`,
      payload: {
        product_name: result.candidate.product_name,
        category: result.candidate.category,
        input_id: result.inputId,
        concept_image_failed: result.conceptImageFailed,
      },
    });
    return NextResponse.json({
      candidate: result.candidate,
      input_id: result.inputId,
      concept_image_path: result.conceptImagePath,
      concept_image_failed: result.conceptImageFailed,
    });
  } catch (err) {
    if (err instanceof DiscoverResearchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
