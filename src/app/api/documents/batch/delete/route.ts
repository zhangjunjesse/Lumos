import { NextRequest, NextResponse } from 'next/server';
import * as docStore from '@/lib/stores/document-store';

/**
 * POST /api/documents/batch/delete
 * Batch delete documents.
 */
export async function POST(req: NextRequest) {
  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 });
  }

  let deleted = 0;
  for (const id of ids) {
    if (docStore.deleteDocument(id)) deleted++;
  }

  return NextResponse.json({ deleted });
}
