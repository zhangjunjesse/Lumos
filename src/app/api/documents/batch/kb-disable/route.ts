import { NextRequest, NextResponse } from 'next/server';
import * as docStore from '@/lib/stores/document-store';

/**
 * POST /api/documents/batch/kb-disable
 * Batch disable knowledge base indexing.
 */
export async function POST(req: NextRequest) {
  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 });
  }

  let updated = 0;
  for (const id of ids) {
    const doc = docStore.updateDocument(id, {
      kb_enabled: 0,
      kb_status: 'disabled',
    });
    if (doc) updated++;
  }

  return NextResponse.json({ updated });
}
