import { NextRequest, NextResponse } from 'next/server';
import * as tagStore from '@/lib/stores/tag-store';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const tag = tagStore.updateTag(id, {
    name: body.name,
    category: body.category,
    color: body.color,
  });
  if (!tag) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(tag);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = tagStore.deleteTag(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
