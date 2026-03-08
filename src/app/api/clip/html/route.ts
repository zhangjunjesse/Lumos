import { NextRequest, NextResponse } from 'next/server';
import { importWebPage } from '@/lib/knowledge/importer';
import { ensureDefaultCollectionId } from '@/lib/knowledge/default-collection';
import * as store from '@/lib/knowledge/store';
import { buildSourceKey } from '@/lib/knowledge/source-key';

/**
 * POST /api/clip/html
 * Browser extension pushes pre-fetched HTML content.
 */
export async function POST(req: NextRequest) {
  const { url, title, text } = await req.json();
  if (!text) {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }

  const collectionId = ensureDefaultCollectionId();
  const sourceKey = buildSourceKey({ sourceType: 'webpage', sourcePath: url || '' });
  let existing = store.findItemBySourceKey(collectionId, sourceKey);
  if (!existing && url) {
    existing = store.findItemBySource(collectionId, 'webpage', url);
  }
  if (existing) {
    return NextResponse.json({ duplicate: true, item: existing, message: '网页已存在，已跳过添加' });
  }

  const result = await importWebPage(
    collectionId,
    title || url || 'Web Clip',
    url || '',
    text,
    sourceKey,
  );
  return NextResponse.json(result);
}
