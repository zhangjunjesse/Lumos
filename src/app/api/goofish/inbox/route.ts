import { NextRequest, NextResponse } from 'next/server';
import { getInbox } from '@/lib/goofish/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/goofish/inbox?account=...&unreadOnly=1&sessionLimit=20&messagesPerChat=10
 *
 * One-shot aggregated view designed for AI consumption: returns recent
 * sessions (filtered to real chats, not system streams) each with the
 * latest N messages embedded. Saves the AI from N+1 tool calls.
 */
export async function GET(req: NextRequest) {
  try {
    const account = req.nextUrl.searchParams.get('account') || '';
    const accountUnb = account && account !== 'all' ? account : undefined;
    const unreadOnly = req.nextUrl.searchParams.get('unreadOnly') === '1';
    const sessionLimit = Math.max(1, Math.min(200, Number(req.nextUrl.searchParams.get('sessionLimit')) || 50));
    const messagesPerChat = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get('messagesPerChat')) || 10));
    const sessions = getInbox({ accountUnb, unreadOnly, sessionLimit, messagesPerChat });
    return NextResponse.json({ ok: true, sessions });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
