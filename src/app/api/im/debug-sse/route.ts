/**
 * Temporary debug endpoint for tracing SSE delivery on the client.
 * The client useTaskEvents handler POSTs here when it actually receives an SSE
 * event so we can correlate server emit ↔ client receive in im-runtime.log.
 *
 * Remove once UI sync is confirmed working.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IM_DEBUG_LOG = path.join(
  process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos'),
  'im-runtime.log',
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { eventType?: string; sessionId?: string; phase?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch { /* ignore */ }

  const line = `[${new Date().toISOString()}] [client/sse] phase=${body.phase ?? 'received'} sessionId=${body.sessionId ?? '?'} type=${body.eventType ?? '?'}\n`;
  try {
    fs.appendFileSync(IM_DEBUG_LOG, line);
  } catch { /* ignore */ }
  return new Response(null, { status: 204 });
}
