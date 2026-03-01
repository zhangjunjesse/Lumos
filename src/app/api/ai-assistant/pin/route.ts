import { NextRequest, NextResponse } from 'next/server';
import * as convStore from '@/lib/stores/conversation-store';

/**
 * POST /api/ai-assistant/pin
 * Pin an ephemeral AI assistant conversation — upgrade to a persisted conversation.
 */
export async function POST(req: NextRequest) {
  const { title, messages } = await req.json();
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  const conv = convStore.createConversation({
    title: title || 'AI Assistant',
    source: 'ai_assistant',
  });

  for (const msg of messages) {
    convStore.addMessage(conv.id, {
      role: msg.role || 'user',
      content: msg.content || '',
    });
  }

  // Mark as pinned
  convStore.updateConversation(conv.id, { is_pinned: 1 });

  return NextResponse.json(convStore.getConversation(conv.id));
}
