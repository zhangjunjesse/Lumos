import { NextRequest, NextResponse } from 'next/server';
import { GoofishCliException } from '@/lib/goofish/cli';
import { login, type GoofishLoginInput } from '@/lib/goofish/auth';
import { cookiesPathFor } from '@/lib/goofish/accounts';
import { setGoofishMcpEnabled } from '@/lib/goofish/mcp-toggle';
import { extractCurrentNick } from '@/lib/goofish/messages';
import { setCachedNick } from '@/lib/goofish/nick-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/goofish/auth/login
 *
 * Body: { mode: 'browser', browser?: string } | { mode: 'paste', cookieString: string }
 *
 * `browser` mode delegates to goofish-cli's browser_cookie3 auto-detect — the
 * user must have logged into goofish.com in their system browser first.
 * `paste` mode takes a raw `Cookie:` header string from devtools.
 *
 * On success the goofish MCP server is auto-enabled so Agents can use it.
 */
export async function POST(req: NextRequest) {
  let body: GoofishLoginInput;
  try {
    body = (await req.json()) as GoofishLoginInput;
  } catch {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('mode' in body)) {
    return NextResponse.json({ error: 'missing_mode' }, { status: 400 });
  }
  if (body.mode !== 'browser' && body.mode !== 'paste' && body.mode !== 'qr') {
    return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });
  }
  if (body.mode === 'paste' && (!body.cookieString || typeof body.cookieString !== 'string')) {
    return NextResponse.json({ error: 'missing_cookie_string' }, { status: 400 });
  }

  try {
    const status = await login(body);
    const mcpEnabled = setGoofishMcpEnabled(true);
    // Goofish's loginuser.get API doesn't return nickname; the only fresh
    // source is `send_user_name` in message history. Fire and forget.
    void extractCurrentNick(status.unb, cookiesPathFor(status.accountUnb))
      .then((nick) => { if (nick) setCachedNick(status.unb, nick); })
      .catch(() => { /* nick cache is best-effort */ });
    return NextResponse.json({
      ok: true,
      accountUnb: status.accountUnb,
      unb: status.unb,
      tracknick: status.tracknick,
      mcpEnabled,
    });
  } catch (err) {
    if (err instanceof GoofishCliException) {
      const httpStatus = err.code === 'NOT_INSTALLED' ? 503 : 400;
      return NextResponse.json({
        ok: false,
        code: err.code,
        message: err.message,
        stderr: err.stderr,
      }, { status: httpStatus });
    }
    return NextResponse.json({
      ok: false,
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
