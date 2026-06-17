import { NextRequest } from 'next/server';
import {
  enableSessionAutoContinue,
  getSession,
  getSessionAutoContinue,
  stopSessionAutoContinue,
} from '@/lib/db';
import { taskEventBus } from '@/lib/task-event-bus';
import { initSessionAutoContinueRunner } from '@/lib/chat/session-auto-continue-runner';
import { abortSessionAutoContinue } from '@/lib/chat/session-auto-continue-abort';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function emitSessionUpdated(sessionId: string): void {
  taskEventBus.emitTaskEvent({
    type: 'task:updated',
    sessionId,
    taskId: '',
    timestamp: Date.now(),
    data: { source: 'session-auto-continue-api' },
  });
}

function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getSession(id)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json({ auto_continue: getSessionAutoContinue(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get auto-continue state';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getSession(id)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const state = enableSessionAutoContinue(id, {
      delaySeconds: readPositiveInt(body.delaySeconds, 60),
      maxRounds: readPositiveInt(body.maxRounds, 100),
      summary: typeof body.summary === 'string' ? body.summary : '',
    });
    initSessionAutoContinueRunner();
    emitSessionUpdated(id);
    return Response.json({ auto_continue: state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enable auto-continue';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getSession(id)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    const aborted = abortSessionAutoContinue(id);
    const state = stopSessionAutoContinue(id, 'User stopped auto-continue');
    emitSessionUpdated(id);
    return Response.json({ auto_continue: state, aborted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop auto-continue';
    return Response.json({ error: message }, { status: 500 });
  }
}
