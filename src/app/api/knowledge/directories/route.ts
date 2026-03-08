import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { clearIngestJobsBySourceDir } from '@/lib/knowledge/ingest-queue';
import { deleteItemsBySourcePathPrefix } from '@/lib/knowledge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null) as
    | { collection_id?: string; source_dir?: string }
    | null;
  const collectionId = body?.collection_id?.trim();
  const sourceDirInput = body?.source_dir?.trim();

  if (!collectionId || !sourceDirInput) {
    return NextResponse.json({ error: 'collection_id and source_dir required' }, { status: 400 });
  }

  const sourceDir = path.resolve(sourceDirInput);
  const cleared = clearIngestJobsBySourceDir(collectionId, sourceDir);
  const deletedItems = deleteItemsBySourcePathPrefix(collectionId, sourceDir);

  return NextResponse.json({
    ok: true,
    source_dir: sourceDir,
    deleted_items: deletedItems,
    cleared_jobs: cleared.cleared_jobs,
    cleared_job_items: cleared.cleared_items,
  });
}
