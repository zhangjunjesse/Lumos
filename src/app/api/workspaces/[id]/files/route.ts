import { NextRequest, NextResponse } from 'next/server';
import * as wsStore from '@/lib/stores/workspace-store';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = wsStore.getWorkspace(id);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = req.nextUrl;
  const opts = {
    kb_status: url.searchParams.get('kb_status') || undefined,
    limit: Number(url.searchParams.get('limit')) || 500,
    offset: Number(url.searchParams.get('offset')) || 0,
  };
  const files = wsStore.listWorkspaceFiles(id, opts);
  return NextResponse.json({ files });
}
