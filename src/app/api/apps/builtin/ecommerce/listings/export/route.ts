import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
  getListingDraft,
  listListingDrafts,
} from '@/lib/ecommerce-assistant/storage';
import {
  exportListing,
  exportListings,
  type ExportFormat,
} from '@/lib/ecommerce-assistant/listing-exporter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED: ExportFormat[] = ['csv', 'markdown', 'json', 'amazon-loader'];

interface BatchBody {
  format?: ExportFormat;
  ids?: unknown;
  bundle?: 'merged' | 'zip';
  status?: string;
  input_id?: string;
}

/**
 * Batch export. Two bundling modes:
 * - merged (default): one combined CSV / markdown / JSON / Amazon loader file
 * - zip: one file per draft, packaged in a single .zip download
 */
export async function POST(req: NextRequest) {
  let body: BatchBody;
  try {
    body = (await req.json()) as BatchBody;
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  const format: ExportFormat = body.format ?? 'csv';
  if (!ALLOWED.includes(format)) {
    return NextResponse.json(
      { error: `不支持的格式：${format}（允许：${ALLOWED.join(', ')}）` },
      { status: 400 },
    );
  }
  const bundle = body.bundle === 'zip' ? 'zip' : 'merged';

  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);

    let drafts;
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.map((x) => String(x).trim()).filter(Boolean);
      drafts = ids
        .map((id) => getListingDraft(store, id))
        .filter((d): d is NonNullable<typeof d> => d != null);
      if (drafts.length === 0) {
        return NextResponse.json(
          { error: '指定 ids 没有找到任何草稿。' },
          { status: 404 },
        );
      }
    } else {
      const filter: Record<string, string> = {};
      if (body.input_id) filter.input_id = body.input_id;
      if (body.status) filter.status = body.status;
      drafts = listListingDrafts(store, filter);
      if (drafts.length === 0) {
        return NextResponse.json({ error: '没有可导出的草稿。' }, { status: 404 });
      }
    }

    if (bundle === 'zip') {
      const zip = new JSZip();
      for (const d of drafts) {
        const payload = exportListing(d, format);
        zip.file(payload.filename, payload.body);
      }
      const buf = await zip.generateAsync({ type: 'uint8array' });
      const stamp = new Date().toISOString().slice(0, 10);
      // Wrap the typed array in a Blob so the Web fetch BodyInit signature is
      // satisfied across Node 20/22 type defs (Uint8Array<ArrayBufferLike> isn't
      // directly assignable to BodyInit on newer @types/node).
      const blob = new Blob([buf as BlobPart], { type: 'application/zip' });
      return new NextResponse(blob, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="listings-${stamp}.zip"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const payload = exportListings(drafts, format);
    return new NextResponse(payload.body, {
      status: 200,
      headers: {
        'Content-Type': payload.contentType,
        'Content-Disposition': `attachment; filename="${payload.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
