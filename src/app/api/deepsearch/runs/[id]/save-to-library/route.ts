import { NextRequest, NextResponse } from 'next/server';
import { getDeepSearchRun } from '@/lib/db';
import { archiveDeepSearchRun } from '@/lib/knowledge/deepsearch-importer';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getDeepSearchRun(id);
  if (!run) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }

  try {
    const result = await archiveDeepSearchRun(id);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[save-to-library] archive failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
