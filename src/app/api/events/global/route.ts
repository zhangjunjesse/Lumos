import { taskEventBus, type TaskEvent } from '@/lib/task-event-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 30_000;

function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function GET(request: Request) {
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

      const unsubscribe = taskEventBus.onTaskEvent((event: TaskEvent) => {
        if (event.sessionId === '__global__') {
          send(event.type, { type: event.type, data: event.data });
        }
      });

      const heartbeat = setInterval(() => {
        send('heartbeat', { ts: Date.now() });
      }, HEARTBEAT_INTERVAL_MS);

      request.signal.addEventListener('abort', () => {
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
