import { NextRequest, NextResponse } from 'next/server';
import * as wsStore from '@/lib/stores/workspace-store';
import path from 'path';
import fs from 'fs';

export async function GET() {
  const workspaces = wsStore.listWorkspaces();
  return NextResponse.json(workspaces);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.path) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }

  // C5: Validate path exists and is a directory
  const resolved = path.resolve(body.path);
  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'Path does not exist' }, { status: 400 });
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
  }

  // Check if workspace already exists for this path
  const existing = wsStore.getWorkspaceByPath(resolved);
  if (existing) {
    return NextResponse.json(
      { error: 'Workspace already exists for this path' },
      { status: 409 },
    );
  }

  const name = body.name || path.basename(resolved);
  const ws = wsStore.createWorkspace(name, resolved);

  if (body.include_patterns || body.exclude_patterns) {
    wsStore.updateWorkspace(ws.id, {
      include_patterns: body.include_patterns,
      exclude_patterns: body.exclude_patterns,
    });
  }

  return NextResponse.json(wsStore.getWorkspace(ws.id));
}
