import { type NextRequest, NextResponse } from 'next/server';

import { createSessionStore, type MessageRole } from '@/lib/app/builder/session';
import { getAppPlatformService } from '@/lib/app/service';

/**
 * GET  /api/apps/builder/sessions/<id>/messages    — list messages chronologically
 * POST /api/apps/builder/sessions/<id>/messages    — append a message
 *
 * v1: this route persists messages but does NOT call Claude — that's the
 * agent runtime (B2 next chunk). The UI can drive it directly to test
 * the persistence loop, and the eventual agent runtime layers in a
 * 'tool' / 'assistant' message after each user 'user' append.
 */

const ALLOWED_ROLES: MessageRole[] = ['user', 'assistant', 'tool'];

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ messages: store.listMessages(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as {
      role?: string;
      content?: unknown;
      toolName?: string;
      tokensIn?: number;
      tokensOut?: number;
    };
    if (!body.role || !ALLOWED_ROLES.includes(body.role as MessageRole)) {
      return NextResponse.json(
        { error: `role must be one of ${ALLOWED_ROLES.join(' / ')}` },
        { status: 400 },
      );
    }
    if (body.content === undefined) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const message = store.appendMessage({
      sessionId: id,
      role: body.role as MessageRole,
      content: body.content,
      toolName: body.toolName,
      tokensIn: body.tokensIn,
      tokensOut: body.tokensOut,
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
