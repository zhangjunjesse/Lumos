import { NextRequest, NextResponse } from 'next/server';
import * as convStore from '@/lib/stores/conversation-store';
import * as docStore from '@/lib/stores/document-store';

/**
 * POST /api/conversations/[id]/to-document
 * Convert a conversation into a document.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conv = convStore.getConversation(id);
  if (!conv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const messages = convStore.listMessages(id);
  // TODO: Use AI to generate a polished document summary instead of raw message dump
  // Build markdown from conversation messages
  const lines: string[] = [`# ${conv.title || 'Conversation'}`, ''];
  for (const msg of messages) {
    const label = msg.role === 'user' ? '**User**' : '**Assistant**';
    lines.push(`${label}:`, '', msg.content, '', '---', '');
  }

  const doc = docStore.createDocument({
    title: conv.title || 'From Conversation',
    content: lines.join('\n'),
    format: 'markdown',
    source_type: 'create',
    source_meta: { from_conversation: id },
  });

  return NextResponse.json(doc);
}
