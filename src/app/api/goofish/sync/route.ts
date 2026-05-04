import { NextRequest, NextResponse } from 'next/server';
import { runSync, runSyncAllAccounts, getLastSyncMs } from '@/lib/goofish/sync';
import { getSyncIntervalMs, setSyncIntervalMs } from '@/lib/goofish/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/goofish/sync — pull fresh sessions + recent messages into the
 * local SQLite archive. Returns a small summary (counts + duration).
 *
 * Body params (all optional):
 *   { fetchNum?: number, watchSecs?: number, messageLimit?: number, since?: number }
 *
 * Manual trigger from panel; can also be called by a scheduled task.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  // If body only carries `intervalMs`, treat as a settings update (don't run sync).
  if (typeof body.intervalMs === 'number' && Object.keys(body).length === 1) {
    const applied = setSyncIntervalMs(body.intervalMs);
    return NextResponse.json({ ok: true, intervalMs: applied });
  }

  const accountUnb = typeof body.account === 'string' && body.account !== 'all' ? body.account : undefined;
  const opts = {
    fetchNum: typeof body.fetchNum === 'number' ? body.fetchNum : undefined,
    watchSecs: typeof body.watchSecs === 'number' ? body.watchSecs : undefined,
    messageLimit: typeof body.messageLimit === 'number' ? body.messageLimit : undefined,
    since: typeof body.since === 'number' ? body.since : undefined,
  };
  if (accountUnb) {
    const result = await runSync({ ...opts, accountUnb });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }
  const results = await runSyncAllAccounts(opts);
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    lastSyncMs: getLastSyncMs(),
    intervalMs: getSyncIntervalMs(),
  });
}
