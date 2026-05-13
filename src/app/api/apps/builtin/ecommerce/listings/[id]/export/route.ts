import { NextRequest, NextResponse } from 'next/server';

import {
  getEcommerceStore,
  getListingDraft,
} from '@/lib/ecommerce-assistant/storage';
import {
  exportListing,
  type ExportFormat,
} from '@/lib/ecommerce-assistant/listing-exporter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED: ExportFormat[] = ['csv', 'markdown', 'json', 'amazon-loader'];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const format = (url.searchParams.get('format') ?? 'markdown') as ExportFormat;
  if (!ALLOWED.includes(format)) {
    return NextResponse.json(
      { error: `不支持的格式：${format}（允许：${ALLOWED.join(', ')}）` },
      { status: 400 },
    );
  }
  try {
    const store = getEcommerceStore();
    const draft = getListingDraft(store, id);
    if (!draft) return NextResponse.json({ error: '草稿不存在。' }, { status: 404 });
    const payload = exportListing(draft, format);
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
