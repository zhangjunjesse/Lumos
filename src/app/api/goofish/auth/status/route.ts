import { NextResponse } from 'next/server';
import { isGoofishInstalled } from '@/lib/goofish/cli';
import { listAccountStatuses, resolveQrLoginMode } from '@/lib/goofish/auth';
import { getGoofishMcpEnabled, setGoofishMcpEnabled } from '@/lib/goofish/mcp-toggle';
import { getCachedNick, setCachedNick } from '@/lib/goofish/nick-cache';
import { extractCurrentNick } from '@/lib/goofish/messages';
import { cookiesPathFor } from '@/lib/goofish/accounts';
import { initGoofishSyncScheduler } from '@/lib/goofish/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/goofish/auth/status
 *
 * Returns goofish state — installed?, list of accounts each with their own
 * loggedIn/nick/etc. Polled by the GoofishPanel.
 *
 * For backwards compat we also surface a single `loggedIn`/`unb`/`nick` set
 * derived from the FIRST valid account — old single-account UI keeps working.
 */
export async function GET() {
  initGoofishSyncScheduler();
  const installed = isGoofishInstalled();
  if (!installed) {
    return NextResponse.json({
      installed: false,
      loggedIn: false,
      mcpEnabled: false,
      qrReady: false,
      qrLoginMode: 'needs-install',
      accounts: [],
    });
  }

  const [accounts, qrLoginMode] = await Promise.all([
    listAccountStatuses(),
    resolveQrLoginMode(),
  ]);
  // Enrich each account with cached nick (fallback when API returns empty).
  const enriched = accounts.map((a) => {
    let nick = a.nick;
    if (a.valid && a.unb && !nick) {
      nick = getCachedNick(a.unb);
      if (!nick) {
        const cookies = cookiesPathFor(a.accountUnb);
        void extractCurrentNick(a.unb, cookies)
          .then((extracted) => { if (extracted) setCachedNick(a.unb, extracted); })
          .catch(() => { /* best-effort */ });
      }
    }
    return { ...a, nick };
  });

  // Self-heal: any account directory with cookies → MCP enabled.
  // We don't require currently-valid token: tokens expire every 10min, but
  // the AI should still see the tools so it can attempt calls and surface
  // a useful error when auth expires (then user can re-login). Disabling the
  // MCP entirely makes the AI think goofish doesn't exist.
  let mcpEnabled = getGoofishMcpEnabled() ?? false;
  const hasAnyAccount = enriched.length > 0;
  if (hasAnyAccount && !mcpEnabled && setGoofishMcpEnabled(true)) mcpEnabled = true;

  // Back-compat single-account fields = first valid account's fields.
  const primary = enriched.find((a) => a.valid) ?? null;

  return NextResponse.json({
    installed: true,
    mcpEnabled,
    qrReady: qrLoginMode !== 'needs-install',
    qrLoginMode,
    accounts: enriched,
    loggedIn: !!primary,
    unb: primary?.unb ?? '',
    nick: primary?.nick ?? '',
    tracknick: primary?.tracknick ?? '',
  });
}
