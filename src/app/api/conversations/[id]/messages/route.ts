import { NextRequest, NextResponse } from 'next/server';
import * as convStore from '@/lib/stores/conversation-store';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conv = convStore.getConversation(id);
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = req.nextUrl;
  const limit = Number(url.searchParams.get('limit')) || 100;
  const offset = Number(url.searchParams.get('offset')) || 0;
  const messages = convStore.listMessages(id, { limit, offset });
  return NextResponse.json({ messages });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conv = convStore.getConversation(id);
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (!body.content) {
    return NextResponse.json({ error: 'content required' }, { status: 400 });
  }

  const msg = convStore.addMessage(id, {
    role: body.role || 'user',
    content: body.content,
    references: body.references,
    cited_doc_ids: body.cited_doc_ids,
    token_count: body.token_count,
  });

  return NextResponse.json(msg);
}
