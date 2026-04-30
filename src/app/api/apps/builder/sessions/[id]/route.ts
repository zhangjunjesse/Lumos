import { type NextRequest, NextResponse } from 'next/server';

import { createSessionStore, type SessionStatus } from '@/lib/app/builder/session';
import { getAppPlatformService } from '@/lib/app/service';

/**
 * GET    /api/apps/builder/sessions/<id>            — session detail (no
 *                                                      messages; use the
 *                                                      messages route for
 *                                                      conversation history)
 * PATCH  /api/apps/builder/sessions/<id>            — body: { status?, needsSummary?, appId? }
 * DELETE /api/apps/builder/sessions/<id>            — discard a session and its
 *                                                      messages + artifacts
 *                                                      (cascade)
 */

const ALLOWED_STATUS: SessionStatus[] = [
  'gathering',
  'generating',
  'installed',
  'iterating',
  'failed',
];

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    const session = store.getSession(id);
    if (!session) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const artifacts = store.getCurrentArtifacts(id);
    return NextResponse.json({
      session,
      messageCount: store.countMessages(id),
      artifacts,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as {
      status?: string;
      needsSummary?: Record<string, unknown>;
      appId?: string;
    };
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (body.status !== undefined) {
      if (!ALLOWED_STATUS.includes(body.status as SessionStatus)) {
        return NextResponse.json(
          { error: `Invalid status: ${body.status}` },
          { status: 400 },
        );
      }
      store.updateStatus(id, body.status as SessionStatus);
    }
    if (body.needsSummary !== undefined) {
      if (body.needsSummary === null || typeof body.needsSummary !== 'object') {
        return NextResponse.json(
          { error: 'needsSummary must be an object' },
          { status: 400 },
        );
      }
      store.setNeedsSummary(id, body.needsSummary);
    }
    if (body.appId !== undefined) {
      try {
        store.bindToApp(id, body.appId);
      } catch (err) {
        return NextResponse.json(
          { error: (err as Error).message },
          { status: 400 },
        );
      }
    }
    return NextResponse.json({ session: store.getSession(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const { db } = getAppPlatformService();
    const info = db
      .prepare(`DELETE FROM lumos_app_builder_sessions WHERE id = ?`)
      .run(id);
    if (info.changes === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
