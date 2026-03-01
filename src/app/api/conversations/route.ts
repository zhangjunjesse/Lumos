import { NextRequest, NextResponse } from 'next/server';
import * as convStore from '@/lib/stores/conversation-store';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const limit = Number(url.searchParams.get('limit')) || 50;
  const page = Number(url.searchParams.get('page')) || 1;
  const opts: convStore.ListConversationsOptions = {
    q: url.searchParams.get('q') || undefined,
    source: url.searchParams.get('source') || undefined,
    is_starred: url.searchParams.get('starred') === '1',
    is_pinned: url.searchParams.get('pinned') === '1',
    workspace_id: url.searchParams.get('workspace_id') || undefined,
    limit,
    offset: (page - 1) * limit,
  };
  const { rows, total } = convStore.listConversations(opts);
  return NextResponse.json({ rows, total });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const conv = convStore.createConversation({
    title: body.title,
    source: body.source,
    source_doc_id: body.source_doc_id,
    workspace_id: body.workspace_id,
    tags: body.tags,
  });
  return NextResponse.json(conv);
}
