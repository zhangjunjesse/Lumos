import { NextRequest, NextResponse } from 'next/server';

import { ingestProductFromUrl, UrlIngestError } from '@/lib/ecommerce-assistant/url-ingest';
import { startJob } from '@/lib/ecommerce-assistant/job-runner';
import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { url?: string; auto_start?: boolean; title_override?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '请求体必须是 JSON。' }, { status: 400 });
  }

  const url = (body.url ?? '').trim();
  if (!url) {
    return NextResponse.json({ error: '缺少 url 字段。' }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'url 必须是 http(s) 完整地址。' }, { status: 400 });
  }

  const store = getEcommerceStore();
  ensureBuiltinStylePresets(store);

  try {
    const ingest = await ingestProductFromUrl({
      url,
      store,
      titleOverride: body.title_override,
    });

    const responseBody: Record<string, unknown> = {
      input_id: ingest.inputId,
      adapter: ingest.adapterId,
      llm_fallback_used: ingest.llmFallbackUsed,
      gallery_count: ingest.galleryCount,
      warnings: ingest.warnings,
      parsed: {
        title: ingest.parsedProduct.title,
        price: ingest.parsedProduct.price,
        category: ingest.parsedProduct.category,
        brand: ingest.parsedProduct.brand,
        bullet_count: ingest.parsedProduct.bullets.length,
        description_chars: ingest.parsedProduct.description?.length ?? 0,
      },
    };

    if (body.auto_start) {
      try {
        const job = await startJob({ inputId: ingest.inputId });
        responseBody.job = job;
      } catch (err) {
        // We deliberately don't fail the whole ingest just because the SOP
        // could not start (e.g. provider not configured). The user can start
        // the job manually from the studio UI.
        responseBody.job_start_error = err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json(responseBody);
  } catch (err) {
    if (err instanceof UrlIngestError) {
      const status = err.stage === 'fetch' || err.stage === 'image-download' ? 502 : 400;
      return NextResponse.json({ error: err.message, stage: err.stage }, { status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
