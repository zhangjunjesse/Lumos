import { NextRequest, NextResponse } from 'next/server';

import { getEcommerceStore } from '@/lib/ecommerce-assistant/storage';
import { persistUploadedImage } from '@/lib/ecommerce-assistant/upload';
import {
  identifyBriefForInput,
  BriefIdentifyError,
} from '@/lib/ecommerce-assistant/brief-identifier';
import { EcommerceLlmUnavailableError } from '@/lib/ecommerce-assistant/llm-client';
import { recordAuditEvent } from '@/lib/ecommerce-assistant/audit-log';
import type { ProductInputRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * Upload a real product photo as the main_image_path of an existing input.
 *
 * This is the user-facing "replace AI placeholder with real sample" path —
 * the pipeline card surfaces it for any input still on the AI concept image.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.startsWith('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Content-Type 必须是 multipart/form-data。' },
        { status: 400 },
      );
    }
    const form = await req.formData();
    const file = form.get('main_image');
    if (!(file instanceof File) || !file.size) {
      return NextResponse.json({ error: '必须上传商品主图。' }, { status: 400 });
    }
    const persisted = await persistUploadedImage(file);
    const store = getEcommerceStore();
    const updated = store.update<ProductInputRecord>('product_inputs', id, {
      main_image_path: persisted.absolutePath,
    });
    if (!updated) return NextResponse.json({ error: '商品输入不存在。' }, { status: 404 });

    recordAuditEvent(store, {
      kind: 'main-image-uploaded',
      targetId: id,
      targetType: 'input',
      inputId: id,
      summary: `上传主图（${file.name ?? 'image'}, ${file.size} 字节）`,
      payload: { path: persisted.absolutePath, size: file.size, name: file.name },
    });

    // Best-effort brief re-identification from the real photo. Failure does
    // not block the upload — the synthesized (confidence=4) brief from
    // discover-promote remains as fallback so listing-drafter still works.
    let briefIdentifyError: string | null = null;
    let briefConfidence: number | null = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      try {
        const briefRow = await identifyBriefForInput(store, id, ctrl.signal);
        briefConfidence = briefRow.confidence ?? null;
        recordAuditEvent(store, {
          kind: 'brief-identified',
          targetId: id,
          targetType: 'input',
          inputId: id,
          summary: `自动识别 brief（confidence ${briefConfidence ?? '?'}/9）`,
          payload: { confidence: briefConfidence, trigger: 'main-image-upload' },
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      briefIdentifyError =
        err instanceof BriefIdentifyError || err instanceof EcommerceLlmUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
    }
    return NextResponse.json({
      input: updated,
      brief_identify_error: briefIdentifyError,
      brief_confidence: briefConfidence,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
