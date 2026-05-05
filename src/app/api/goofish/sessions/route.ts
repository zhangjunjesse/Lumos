import { NextRequest, NextResponse } from 'next/server';
import { listSessions } from '@/lib/goofish/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/goofish/sessions[?account=<unb>]
 *
 *   - account=<unb>  → only that account's sessions
 *   - account=all (or omitted) → sessions from all accounts, mixed
 */
export async function GET(req: NextRequest) {
  try {
    const account = req.nextUrl.searchParams.get('account') || '';
    const filter = account && account !== 'all' ? account : undefined;
    const sessions = listSessions({ accountUnb: filter, limit: 500 });
    return NextResponse.json({ ok: true, sessions, account: filter ?? 'all' });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
