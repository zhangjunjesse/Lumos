import { NextRequest, NextResponse } from 'next/server';
import * as wsStore from '@/lib/stores/workspace-store';

/**
 * POST /api/workspaces/[id]/scan
 * Trigger incremental scan of workspace directory.
 * Placeholder — actual file scanning logic will be wired later.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = wsStore.getWorkspace(id);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  wsStore.updateWorkspace(id, { status: 'scanning' });

  // TODO: trigger actual file system scan in background
  // For now, mark as ready immediately
  wsStore.updateWorkspace(id, {
    status: 'ready',
    last_scanned_at: new Date().toISOString().replace('T', ' ').split('.')[0],
  });

  return NextResponse.json(wsStore.getWorkspace(id));
}
