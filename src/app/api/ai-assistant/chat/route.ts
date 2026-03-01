import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/ai-assistant/chat
 * Lightweight ephemeral chat — no persistence.
 * Placeholder: actual AI streaming will be wired to Claude client.
 */
export async function POST(req: NextRequest) {
  const { message, context } = await req.json();
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }

  // TODO: wire to Claude client for streaming SSE response
  // For now return a placeholder acknowledging the request
  return NextResponse.json({
    role: 'assistant',
    content: `[AI assistant placeholder] Received: "${message.slice(0, 100)}"`,
    context: context || null,
  });
}
