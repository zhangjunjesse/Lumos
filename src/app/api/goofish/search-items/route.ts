import { NextRequest, NextResponse } from 'next/server';
import { searchGoofishItems } from '@/lib/goofish/browser-search';
import { listAccounts } from '@/lib/goofish/accounts';
import { goofishAuthExpiredResponse, isGoofishAuthExpiredError } from '@/lib/goofish/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 120s ceiling: cookie one-by-one injection (when bulk fails on HttpOnly
// conflict) can spend 30-60s, plus page navigate + risk-control settling.
export const maxDuration = 120;

/**
 * GET /api/goofish/search-items?q=KEYWORD&account=<unb>&limit=N
 *
 * Live item search via Lumos's embedded browser (background mode). Replaces
 * goofish-cli's `search_items` which would otherwise spawn a visible Chrome
 * window. If `account` is omitted, uses the first available account's cookies.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (!q) {
    return NextResponse.json({ ok: false, message: 'q is required' }, { status: 400 });
  }
  const limit = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get('limit')) || 30));

  let account = req.nextUrl.searchParams.get('account') || '';
  if (!account || account === 'all') {
    // Auto-pick the first valid account.
    const accs = listAccounts().filter((a) => a.hasCookies);
    account = accs[0]?.unb || '';
  }
  if (!account) {
    return NextResponse.json({ ok: false, message: '没有已登录账号' }, { status: 400 });
  }

  try {
    const result = await searchGoofishItems(q, { accountUnb: account, limit });
    if (result.blocked) {
      return NextResponse.json({
        ok: false,
        code: 'RISK_CONTROL',
        message: `闲鱼风控拦截（${result.blockReason || '非法访问'}）—— 在 Lumos 内置浏览器手动打开 goofish.com 走一次再试`,
        sourceUrl: result.sourceUrl,
      }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      account,
      sourceUrl: result.sourceUrl,
      items: result.items,
      bodyLen: result.bodyLen,
      fallbackUsed: result.fallbackUsed,
    });
  } catch (err) {
    if (isGoofishAuthExpiredError(err)) {
      return goofishAuthExpiredResponse({ accountUnb: account });
    }
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
