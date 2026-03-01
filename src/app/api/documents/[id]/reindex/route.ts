import { NextRequest, NextResponse } from 'next/server';
import * as docStore from '@/lib/stores/document-store';

/**
 * POST /api/documents/[id]/reindex
 * Manually trigger re-indexing for a document.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = docStore.getDocument(id);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  docStore.updateDocument(id, {
    kb_status: 'pending',
    kb_error: '',
  });

  return NextResponse.json({ id, kb_status: 'pending' });
}
