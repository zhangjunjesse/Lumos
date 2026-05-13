import { NextRequest, NextResponse } from 'next/server';
import { logout } from '@/lib/goofish/auth';
import { listAccounts } from '@/lib/goofish/accounts';
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
 * 关键: 不能调 listAccountStatuses(那会对每个账号 spawn `goofish auth status`,
 * cookies 已过期时每个 ~30s 阻塞 → 用户看到"退出按钮一直转圈")。改用纯磁盘
 * listAccounts(同步 readdirSync),瞬间完成。
 */
export async function POST(req: NextRequest) {
  let body: { account?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  if (body.account) {
    logout(body.account);
  } else {
    for (const acc of listAccounts()) logout(acc.unb);
    logout();  // legacy ~/.goofish-cli/ too
  }

  const remaining = listAccounts().filter((a) => a.hasCookies);
  if (remaining.length === 0) setGoofishMcpEnabled(false);

  return NextResponse.json({ ok: true, remainingAccounts: remaining.length });
}
