import { NextResponse, type NextRequest } from 'next/server';

import { createSessionStore } from '@/lib/app/builder/session';
import { getAppPlatformService } from '@/lib/app/service';

/**
 * GET  /api/apps/builder/sessions       — list builder sessions, newest first
 * POST /api/apps/builder/sessions       — create a session (optionally with
 *                                         templateId / llmModel)
 *
 * The agent runtime (B2) reads the system prompt from sessions tagged with
 * a templateId; the conversation lives in /sessions/<id>/messages, the
 * generated files in artifacts. v1 ships the persistence + CRUD; the
 * Claude SDK bridge replaces a mock-assistant POST in the next chunk.
 */

export async function GET(): Promise<NextResponse> {
  try {
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    const sessions = store.listSessions({ limit: 100 });
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      appName?: string;
      appDescription?: string;
      templateId?: string;
      llmModel?: string;
    };
    if (typeof body.appName !== 'string' || body.appName.trim().length === 0) {
      return NextResponse.json(
        { error: 'appName is required' },
        { status: 400 },
      );
    }
    if (body.appName.length > 64) {
      return NextResponse.json(
        { error: 'appName must be ≤ 64 characters' },
        { status: 400 },
      );
    }
    const description = typeof body.appDescription === 'string' ? body.appDescription.trim() : '';
    if (description.length > 500) {
      return NextResponse.json(
        { error: 'appDescription must be ≤ 500 characters' },
        { status: 400 },
      );
    }
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    const session = store.createSession({
      appName: body.appName.trim(),
      appDescription: description || undefined,
      templateId: body.templateId,
      llmModel: body.llmModel,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
