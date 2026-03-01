import { NextRequest, NextResponse } from 'next/server';
import * as docStore from '@/lib/stores/document-store';

/**
 * POST /api/documents/import/feishu
 * Import a Feishu document by URL/token.
 * Actual Feishu API fetching is a placeholder — will be wired to feishu-auth service.
 */
export async function POST(req: NextRequest) {
  const { url, docToken, title } = await req.json();
  if (!url && !docToken) {
    return NextResponse.json({ error: 'url or docToken required' }, { status: 400 });
  }

  const doc = docStore.createDocument({
    title: title || 'Feishu Import',
    source_type: 'feishu',
    source_path: url || docToken,
    source_meta: { url, docToken },
    format: 'markdown',
  });

  // Mark as parsing — actual content fetch happens async
  docStore.updateDocument(doc.id, { status: 'parsing' });

  return NextResponse.json(doc);
}
