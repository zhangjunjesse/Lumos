import { NextRequest, NextResponse } from 'next/server';
import * as wsStore from '@/lib/stores/workspace-store';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = wsStore.getWorkspace(id);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(ws);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const ws = wsStore.updateWorkspace(id, {
    name: body.name,
    include_patterns: body.include_patterns,
    exclude_patterns: body.exclude_patterns,
  });
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(ws);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = wsStore.deleteWorkspace(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
