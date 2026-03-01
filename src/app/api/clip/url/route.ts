import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/knowledge/store';
import { importWebPage } from '@/lib/knowledge/importer';

/**
 * POST /api/clip/url
 * Fetch a URL and create a knowledge item from its content.
 */
export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }

  // Ensure a default collection exists
  let collections = store.listCollections();
  if (collections.length === 0) {
    store.createCollection('Default', 'Auto-created');
    collections = store.listCollections();
  }
  const collectionId = collections[0].id;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Lumos/1.0' },
    });
    const html = await res.text();
    // Strip HTML tags for plain text
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || url;

    const result = await importWebPage(collectionId, title, url, text);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
