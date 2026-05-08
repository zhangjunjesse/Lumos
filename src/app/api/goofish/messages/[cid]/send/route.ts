import { NextRequest, NextResponse } from 'next/server';
import { GoofishCliException } from '@/lib/goofish/cli';
import { sendMessage } from '@/lib/goofish/messages';
import { goofishAuthExpiredResponse, isGoofishAuthExpiredError } from '@/lib/goofish/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/goofish/messages/:cid/send
 * Body: { toid: string, text: string }
 *
 * Sends a text message to the given conversation. The chat detail page
 * should re-fetch history after a successful POST to show the new message.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ cid: string }> },
) {
  const { cid } = await params;
  if (!cid) return NextResponse.json({ ok: false, message: 'missing cid' }, { status: 400 });

  let body: { toid?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'invalid json' }, { status: 400 });
  }
  const toid = (body.toid || '').trim();
  const text = (body.text || '').trim();
  if (!toid || !text) {
    return NextResponse.json({ ok: false, message: 'toid and text are required' }, { status: 400 });
  }

  try {
    await sendMessage(cid, toid, text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isGoofishAuthExpiredError(err)) {
      return goofishAuthExpiredResponse();
    }
    if (err instanceof GoofishCliException) {
      return NextResponse.json({ ok: false, code: err.code, message: err.message }, { status: 400 });
    }
    return NextResponse.json({
      ok: false,
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
