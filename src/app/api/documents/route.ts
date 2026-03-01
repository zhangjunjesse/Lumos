import { NextRequest, NextResponse } from 'next/server';
import * as docStore from '@/lib/stores/document-store';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const opts: docStore.ListDocumentsOptions = {
    q: url.searchParams.get('q') || undefined,
    source_type: url.searchParams.get('source_type') || undefined,
    kb_status: url.searchParams.get('kb_status') || undefined,
    status: url.searchParams.get('status') || undefined,
    sort: (url.searchParams.get('sort') as 'updated_at' | 'created_at' | 'title') || undefined,
    order: (url.searchParams.get('order') as 'asc' | 'desc') || undefined,
    limit: Number(url.searchParams.get('limit')) || 50,
    offset: ((Number(url.searchParams.get('page')) || 1) - 1) * (Number(url.searchParams.get('limit')) || 50),
  };
  const { rows, total } = docStore.listDocuments(opts);
  return NextResponse.json({ rows, total });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const doc = docStore.createDocument({
    title: body.title,
    content: body.content,
    format: body.format,
    source_type: body.source_type,
    source_path: body.source_path,
    source_meta: body.source_meta,
    tags: body.tags,
  });
  return NextResponse.json(doc);
}
