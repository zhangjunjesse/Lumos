import { NextRequest } from 'next/server';
import { listDueSessionAutoContinues, markSessionAutoContinueRunning, recordSessionAutoContinueFailure, stopSessionAutoContinue } from '@/lib/db';
import { getSessionAutoContinue } from '@/lib/db/session-auto-continue';
import { taskEventBus } from '@/lib/task-event-bus';

const TICK_MS = 10_000;
const INTERNAL_AUTO_CONTINUE_PROMPT = `[Lumos auto-continue]\nContinue the existing long-running work in this same chat session. Review the prior context, perform the next useful step, and decide whether this same session should continue later. If it should continue, end with the required hidden lumos:auto-continue control comment.`;

declare global {
  var __lumos_session_auto_continue_timer__: ReturnType<typeof setInterval> | undefined;
  var __lumos_session_auto_continue_running__: boolean | undefined;
}

function emitSessionUpdated(sessionId: string): void {
  taskEventBus.emitTaskEvent({
    type: 'task:updated',
    sessionId,
    taskId: '',
    timestamp: Date.now(),
    data: { source: 'session-auto-continue' },
  });
}

async function consumeResponse(response: Response): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

async function runDueSessions(): Promise<void> {
  if (global.__lumos_session_auto_continue_running__) return;
  global.__lumos_session_auto_continue_running__ = true;
  try {
    const due = listDueSessionAutoContinues();
    for (const item of due) {
      if (item.round >= item.max_rounds) {
        stopSessionAutoContinue(item.session_id, 'Reached maximum auto-continue rounds');
        emitSessionUpdated(item.session_id);
        continue;
      }

      try {
        markSessionAutoContinueRunning(item.session_id);
        emitSessionUpdated(item.session_id);
        const { POST } = await import('@/app/api/chat/route');
        const request = new NextRequest('http://lumos.local/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-lumos-auto-continue': '1',
          },
          body: JSON.stringify({
            session_id: item.session_id,
            content: INTERNAL_AUTO_CONTINUE_PROMPT,
          }),
        });
        const response = await POST(request);
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `Auto-continue request failed: ${response.status}`);
        }
        await consumeResponse(response);
        const state = getSessionAutoContinue(item.session_id);
        if (state?.stop_requested) {
          continue;
        }
      } catch (error) {
        const state = getSessionAutoContinue(item.session_id);
        if (!state?.stop_requested) {
          const message = error instanceof Error ? error.message : String(error);
          recordSessionAutoContinueFailure(item.session_id, message);
        }
      } finally {
        emitSessionUpdated(item.session_id);
      }
    }
  } finally {
    global.__lumos_session_auto_continue_running__ = false;
  }
}

export function initSessionAutoContinueRunner(): void {
  if (global.__lumos_session_auto_continue_timer__) return;
  global.__lumos_session_auto_continue_timer__ = setInterval(() => {
    runDueSessions().catch((error) => {
      console.error('[session-auto-continue] tick failed:', error);
    });
  }, TICK_MS);
  runDueSessions().catch((error) => {
    console.error('[session-auto-continue] initial tick failed:', error);
  });
}
