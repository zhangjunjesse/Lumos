import { NextRequest, NextResponse } from 'next/server';
import * as convStore from '@/lib/stores/conversation-store';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conv = convStore.getConversation(id);
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const messages = convStore.listMessages(id);
  return NextResponse.json({ ...conv, messages });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const conv = convStore.updateConversation(id, {
    title: body.title,
    summary: body.summary,
    is_pinned: body.is_pinned,
    is_starred: body.is_starred,
    tags: body.tags,
    workspace_id: body.workspace_id,
  });
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(conv);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = convStore.deleteConversation(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
