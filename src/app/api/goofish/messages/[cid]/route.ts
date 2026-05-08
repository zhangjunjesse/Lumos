import { NextRequest, NextResponse } from 'next/server';
import { GoofishCliException } from '@/lib/goofish/cli';
import { getMessageHistory } from '@/lib/goofish/messages';
import { findAccountForCid } from '@/lib/goofish/db';
import { cookiesPathFor } from '@/lib/goofish/accounts';
import { goofishAuthExpiredResponse, isGoofishAuthExpiredError } from '@/lib/goofish/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/goofish/messages/:cid
 *
 * Returns the full message history for a single conversation, oldest → newest.
 * Drives the right-pane detail view in the GoofishPanel.
 *
 * Note: system streams (session_type=3 like 系统消息) often return [] here —
 * goofish-cli's `message history` only fetches peer-to-peer chat content,
 * not platform notification feeds. Caller should render the empty state.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cid: string }> },
) {
  const { cid } = await params;
  if (!cid) {
    return NextResponse.json({ ok: false, message: 'missing cid' }, { status: 400 });
  }

  // Resolve which account this cid belongs to so we hit goofish-cli with
  // the correct cookies. Caller can also pass ?account=<unb> explicitly.
  const explicit = req.nextUrl.searchParams.get('account') || '';
  const accountUnb = (explicit && explicit !== 'all') ? explicit : findAccountForCid(cid);
  const cookiesPath = accountUnb ? cookiesPathFor(accountUnb) : undefined;

  try {
    const messages = await getMessageHistory(cid, 50, cookiesPath);
    return NextResponse.json({ ok: true, messages, accountUnb });
  } catch (err) {
    if (isGoofishAuthExpiredError(err)) {
      return goofishAuthExpiredResponse({ accountUnb });
    }
    if (err instanceof GoofishCliException) {
      const httpStatus = err.code === 'NOT_INSTALLED' ? 503 : 400;
      return NextResponse.json({
        ok: false,
        code: err.code,
        message: err.message,
      }, { status: httpStatus });
    }
    return NextResponse.json({
      ok: false,
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
