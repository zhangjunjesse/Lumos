import { NextRequest, NextResponse } from 'next/server';
import { logout, listAccountStatuses } from '@/lib/goofish/auth';
import { setGoofishMcpEnabled } from '@/lib/goofish/mcp-toggle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/goofish/auth/logout
 *
 * Body: { account?: string }
 *   - account=<unb>  → delete only that account's directory
 *   - omitted       → clear ALL accounts (and the legacy single-account file)
 *
 * Disables the goofish MCP only when no valid accounts remain.
 */
export async function POST(req: NextRequest) {
  let body: { account?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  if (body.account) {
    logout(body.account);
  } else {
    // Wipe all known accounts.
    for (const acc of await listAccountStatuses()) logout(acc.accountUnb);
    logout();  // legacy ~/.goofish-cli/ too
  }

  // Only disable MCP if there are no logged-in accounts left.
  const remaining = (await listAccountStatuses()).filter((a) => a.valid);
  if (remaining.length === 0) setGoofishMcpEnabled(false);

  return NextResponse.json({ ok: true, remainingAccounts: remaining.length });
}
