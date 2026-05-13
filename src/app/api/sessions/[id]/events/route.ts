import { taskEventBus, type TaskEvent } from '@/lib/task-event-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Per-session SSE endpoint。chat page 订阅这里,服务端 taskEventBus 上 emit 的
 * `task:updated`(包括 IM/微信入站消息触发的 db.addMessage)会立即转发到客户端。
 *
 * 此前这个 endpoint 在某次 refactor 里被删了,导致 ChatView 永远不知道有新消息
 * (chat page 的 bridge:event IPC 监听器没有对应 emitter)。重建一条干净的
 * SSE 路径作为唯一真实事件源。
 */
function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return new Response('Missing session id', { status: 400 });
  }

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

      // 初次订阅时立刻推一条 hello,客户端能确认 SSE 连上了。
      send('hello', { sessionId: id, ts: Date.now() });

      const unsubscribe = taskEventBus.onTaskEvent((event: TaskEvent) => {
        if (event.sessionId !== id) return;
        send(event.type, { type: event.type, sessionId: event.sessionId, data: event.data });
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
