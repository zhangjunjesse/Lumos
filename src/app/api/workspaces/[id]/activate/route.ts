import { NextRequest, NextResponse } from 'next/server';
import * as wsStore from '@/lib/stores/workspace-store';

/**
 * POST /api/workspaces/[id]/activate
 * Set this workspace as the active workspace.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = wsStore.getWorkspace(id);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  wsStore.setActiveWorkspace(id);
  return NextResponse.json(wsStore.getWorkspace(id));
}
