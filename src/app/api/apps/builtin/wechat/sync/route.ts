import { NextRequest, NextResponse } from 'next/server';

import { getSyncState } from '@/lib/wechat-assistant/mirror-store';
import {
  isSyncInFlight,
  runSync,
  type SyncProgressEvent,
} from '@/lib/wechat-assistant/sync-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — current state for the sync banner. */
export async function GET() {
  const state = getSyncState();
  return NextResponse.json({
    cursorTs: state.cursorTs,
    lastFinishedAt: state.lastFinishedAt,
    lastError: state.lastError,
    totalMessages: state.totalMessages,
    firstStartedAt: state.firstStartedAt,
    inFlight: isSyncInFlight(),
  });
}

interface SyncRequestBody {
  fullResync?: boolean;
}

/**
 * POST — start a sync. Returns NDJSON streaming progress.
 *
 * Each line of the response body is a JSON event from `SyncProgressEvent`,
 * letting the UI show real-time "synced N / M sessions" feedback.
 */
export async function POST(req: NextRequest) {
  let body: SyncRequestBody = {};
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      body = (await req.json()) as SyncRequestBody;
    }
  } catch { /* ignore — empty body is fine */ }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (event: SyncProgressEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      void runSync({
        fullResync: !!body.fullResync,
        signal: abort.signal,
        onEvent: writeEvent,
      })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          writeEvent({ type: 'error', message });
        })
        .finally(() => controller.close());
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
