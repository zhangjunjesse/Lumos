import { taskEventBus, type TaskEvent } from '@/lib/task-event-bus';
import { ensureSessionTeamRunsExecution } from '@/lib/db/tasks';
import { getSessionTeamBannerProjection } from '@/lib/team-run/projections';

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

      // Subscribe to task events for this session
      const unsubscribe = taskEventBus.onSessionEvents(sessionId, (event: TaskEvent) => {
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
