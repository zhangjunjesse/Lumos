import { NextRequest, NextResponse } from 'next/server';
import { importWebPage } from '@/lib/knowledge/importer';
import { ensureDefaultCollectionId } from '@/lib/knowledge/default-collection';
import * as store from '@/lib/knowledge/store';
import { buildSourceKey } from '@/lib/knowledge/source-key';

/**
 * POST /api/clip/url
 * Fetch a URL and create a knowledge item from its content.
 */
export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }

  const collectionId = ensureDefaultCollectionId();
  const sourceKey = buildSourceKey({ sourceType: 'webpage', sourcePath: url });
  let existing = store.findItemBySourceKey(collectionId, sourceKey);
  if (!existing) {
    existing = store.findItemBySource(collectionId, 'webpage', url);
  }
  if (existing) {
    return NextResponse.json({ duplicate: true, item: existing, message: '网页已存在，已跳过添加' });
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Lumos/1.0' },
    });
    const html = await res.text();
    // Strip HTML tags for plain text
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || url;

    const result = await importWebPage(collectionId, title, url, text, sourceKey);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
