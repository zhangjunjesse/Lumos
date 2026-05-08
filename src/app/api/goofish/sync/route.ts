import { NextRequest, NextResponse } from 'next/server';
import { runSync, runSyncAllAccounts, getLastSyncMs } from '@/lib/goofish/sync';
import { getSyncIntervalMs, setSyncIntervalMs } from '@/lib/goofish/db';
import {
  goofishAuthExpiredResponse,
  isGoofishAuthExpiredError,
  isGoofishAuthExpiredMessage,
} from '@/lib/goofish/auth-error';

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
    try {
      const result = await runSync({ ...opts, accountUnb });
      if (!result.ok && isGoofishAuthExpiredMessage(result.error)) {
        return goofishAuthExpiredResponse({ accountUnb });
      }
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    } catch (err) {
      // runSync 内部 fetchFatChats 抛 mtop 错时会跑到这里(单账号路径无 try/catch)
      if (isGoofishAuthExpiredError(err)) {
        return goofishAuthExpiredResponse({ accountUnb });
      }
      return NextResponse.json({
        ok: false, accountUnb,
        error: err instanceof Error ? err.message : String(err),
      }, { status: 500 });
    }
  }
  const results = await runSyncAllAccounts(opts);
  const ok = results.every((r) => r.ok);
  // 全部账号都因登录过期失败 → 返回统一 401，让 UI 拦截
  if (!ok && results.length > 0
      && results.every((r) => !r.ok && isGoofishAuthExpiredMessage(r.error))) {
    return goofishAuthExpiredResponse();
  }
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    lastSyncMs: getLastSyncMs(),
    intervalMs: getSyncIntervalMs(),
  });
}
