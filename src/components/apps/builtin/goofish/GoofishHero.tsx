'use client';

import * as React from 'react';
import { Fish } from 'lucide-react';

import type { GoofishAccountStatus } from './goofish-types';

interface GoofishHeroProps {
  accounts: GoofishAccountStatus[];
  loggedInCount: number;
  loading: boolean;
}

/**
 * Mirrors the WeChatHero — a slim title bar with the app icon. Adds account
 * meta on the right because goofish supports multi-account, unlike wechat.
 */
export function GoofishHero({
  accounts,
  loggedInCount,
  loading,
}: GoofishHeroProps): React.ReactElement {
  const activeAccount = accounts.find((a) => a.loggedIn) ?? null;
  return (
    <header className="border-b">
      <div className="flex items-center justify-between gap-4 px-10 py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
            <Fish className="size-5" strokeWidth={1.75} />
          </div>
          <h1 className="text-base font-semibold tracking-tight">闲鱼助手</h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {loading ? (
            <span>加载中…</span>
          ) : (
            <>
              <AccountSummary
                activeAccount={activeAccount}
                loggedInCount={loggedInCount}
                totalAccounts={accounts.length}
              />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function AccountSummary({
  activeAccount,
  loggedInCount,
  totalAccounts,
}: {
  activeAccount: GoofishAccountStatus | null;
  loggedInCount: number;
  totalAccounts: number;
}): React.ReactElement {
  if (totalAccounts === 0) {
    return <span>未登录任何账号</span>;
  }
  return (
    <span className="flex items-center gap-2">
      {activeAccount ? (
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="text-foreground">
            {activeAccount.nick || activeAccount.unb || '账号'}
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-amber-500" />
          <span>账号已离线</span>
        </span>
      )}
      <span className="text-muted-foreground/60">·</span>
      <span className="tabular-nums">
        {loggedInCount}/{totalAccounts} 在线
      </span>
    </span>
  );
}
