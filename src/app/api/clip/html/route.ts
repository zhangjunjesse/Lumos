import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/knowledge/store';
import { importWebPage } from '@/lib/knowledge/importer';

/**
 * POST /api/clip/html
 * Browser extension pushes pre-fetched HTML content.
 */
export async function POST(req: NextRequest) {
  const { url, title, text } = await req.json();
  if (!text) {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }

  let collections = store.listCollections();
  if (collections.length === 0) {
    store.createCollection('Default', 'Auto-created');
    collections = store.listCollections();
  }

  const result = await importWebPage(
    collections[0].id,
    title || url || 'Web Clip',
    url || '',
    text,
  );
  return NextResponse.json(result);
}
