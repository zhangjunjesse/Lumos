import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { taskEventBus, type TaskEvent } from '@/lib/task-event-bus';
import { ensureSessionTeamRunsExecution } from '@/lib/db/tasks';
import { getSessionTeamBannerProjection } from '@/lib/team-run/projections';

const IM_DEBUG_LOG = path.join(
  process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos'),
  'im-runtime.log',
);
function imRuntimeLog(line: string): void {
  try {
    fs.appendFileSync(IM_DEBUG_LOG, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // ignore
  }
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id: sessionId } = await context.params;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(formatSSE(event, data)));
        } catch {
          // stream closed
        }
      };

      // Send initial snapshot
      try {
        ensureSessionTeamRunsExecution(sessionId);
        const banner = getSessionTeamBannerProjection(sessionId);
        send('snapshot', { banner });
      } catch {
        send('snapshot', { banner: null });
      }

      imRuntimeLog(`[sse] subscribe sessionId=${sessionId} totalListeners=${taskEventBus.listenerCount('task-event') + 1}`);
      // Subscribe to task events for this session
      const unsubscribe = taskEventBus.onSessionEvents(sessionId, (event: TaskEvent) => {
        imRuntimeLog(`[sse] forward sessionId=${sessionId} type=${event.type} eventSessionId=${event.sessionId}`);
        send(event.type, {
          taskId: event.taskId,
          runId: event.runId,
          stageId: event.stageId,
          data: event.data,
        });
      });

      // Heartbeat
      const heartbeat = setInterval(() => {
        send('heartbeat', { ts: Date.now() });
      }, HEARTBEAT_INTERVAL_MS);

      // Cleanup on close
      _request.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
