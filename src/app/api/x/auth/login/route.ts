import { NextRequest, NextResponse } from 'next/server';
import {
  loginViaBuiltinBrowser,
  loginViaCookieString,
  XBrowserUnavailableError,
} from '@/lib/x-platform/auth';
import { XAuthExpiredError } from '@/lib/x-platform/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

interface BrowserLoginBody {
  mode?: 'browser';
  timeoutSecs?: number;
}
interface PasteLoginBody {
  mode: 'paste';
  cookieString: string;
  screenName?: string;
  name?: string;
}
type LoginBody = BrowserLoginBody | PasteLoginBody;

export async function POST(req: NextRequest) {
  let body: LoginBody = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  try {
    if (body && (body as PasteLoginBody).mode === 'paste') {
      const paste = body as PasteLoginBody;
      const cookieString = paste.cookieString || '';
      if (!cookieString.trim()) {
        return NextResponse.json({ ok: false, message: 'cookieString 不能为空' }, { status: 400 });
      }
      if (cookieString.length > 64_000) {
        return NextResponse.json({ ok: false, message: 'cookieString 过长,请只粘贴必要 cookie' }, { status: 400 });
      }
      const status = await loginViaCookieString(cookieString, {
        screenName: typeof paste.screenName === 'string' ? paste.screenName : undefined,
        name: typeof paste.name === 'string' ? paste.name : undefined,
      });
      return NextResponse.json({ ok: true, ...status });
    }

    const status = await loginViaBuiltinBrowser({
      timeoutSecs: (body as BrowserLoginBody)?.timeoutSecs,
    });
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    if (err instanceof XBrowserUnavailableError) {
      return NextResponse.json({ ok: false, code: 'BROWSER_UNAVAILABLE', message: err.message }, { status: 503 });
    }
    if (err instanceof XAuthExpiredError) {
      return NextResponse.json({ ok: false, code: 'LOGIN_FAILED', message: err.message }, { status: 400 });
    }
    return NextResponse.json({
      ok: false,
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
