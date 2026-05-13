import { NextResponse } from 'next/server';

import { getAppPlatformService } from '@/lib/app/service';
import { listAccountStatuses } from '@/lib/goofish/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let installedVersion: string | null = null;
  let installError: string | null = null;
  try {
    const svc = getAppPlatformService();
    const row = svc.db
      .prepare('SELECT version FROM lumos_app_apps WHERE id = ?')
      .get('goofish-assistant') as { version: string } | undefined;
    installedVersion = row?.version ?? null;
  } catch (err) {
    installError = err instanceof Error ? err.message : String(err);
  }

  let accounts: Array<{ unb: string; nick?: string; loggedIn: boolean }> = [];
  let authError: string | null = null;
  try {
    const list = await listAccountStatuses();
    accounts = list.map((a) => ({
      unb: a.accountUnb ?? '',
      nick: a.nick || undefined,
      loggedIn: a.valid === true,
    }));
  } catch (err) {
    authError = err instanceof Error ? err.message : String(err);
  }

  const loggedInCount = accounts.filter((a) => a.loggedIn).length;
  const ready = installedVersion !== null && loggedInCount > 0;
  const phase = !installedVersion
    ? 'needs-install'
    : loggedInCount === 0
      ? 'needs-auth'
      : 'ready';

  return NextResponse.json({
    app: builtinAppMeta(phase),
    install: {
      installed: installedVersion !== null,
      version: installedVersion,
      error: installError,
    },
    auth: {
      ready: loggedInCount > 0,
      accountCount: accounts.length,
      loggedInCount,
      accounts,
      error: authError,
    },
    ready,
    phase,
  });
}

function builtinAppMeta(status: string) {
  return {
    id: 'goofish-assistant',
    name: '闲鱼助手',
    version: '0.1.0',
    source: 'builtin',
    category: 'communication',
    status,
  };
}
