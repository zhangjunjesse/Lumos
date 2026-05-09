import { NextRequest } from 'next/server';

import { subscribeJob } from '@/lib/ecommerce-assistant/job-runner';
import { getEcommerceStore, getJob } from '@/lib/ecommerce-assistant/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENCODER = new TextEncoder();

function sseFrame(eventName: string, data: unknown): Uint8Array {
  return ENCODER.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId) {
    return new Response(JSON.stringify({ error: '必须提供 job_id。' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const sendSnapshot = (): boolean => {
        try {
          const store = getEcommerceStore();
          const job = getJob(store, jobId);
          if (job) {
            controller.enqueue(sseFrame('job', job));
            if (['completed', 'failed', 'cancelled'].includes(job.status)) {
              controller.enqueue(sseFrame('done', { jobId, status: job.status }));
              close();
              return true;
            }
          }
          return false;
        } catch (err) {
          controller.enqueue(
            sseFrame('error', {
              message: err instanceof Error ? err.message : String(err),
            }),
          );
          return false;
        }
      };

      const finishedFromSnapshot = sendSnapshot();
      if (finishedFromSnapshot) return;

      const unsubscribe = subscribeJob(jobId, (event) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame('progress', event));
          if (
            event.status === 'completed'
            || event.status === 'failed'
            || event.status === 'cancelled'
          ) {
            sendSnapshot();
          }
        } catch (err) {
          if (!closed) controller.error(err);
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(ENCODER.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      const onAbort = () => {
        clearInterval(heartbeat);
        unsubscribe();
        close();
      };

      req.signal.addEventListener('abort', onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
