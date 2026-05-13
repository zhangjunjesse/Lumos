'use client';

import * as React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { GoofishLoginForm } from '@/components/goofish/GoofishLoginForm';
import { useGoofishAuth } from '@/components/goofish/use-goofish-auth';
import { cn } from '@/lib/utils';

import type { GoofishAssistantStatus } from './goofish-types';
import { GoofishLoginBrowserModal } from './GoofishLoginBrowserModal';

interface SetupBannerProps {
  status: GoofishAssistantStatus | null;
  onRefresh: () => void;
}

export function SetupBanner({
  status,
  onRefresh,
}: SetupBannerProps): React.ReactElement | null {
  if (!status) return null;
  if (status.ready) return null;

  const message = status.phase === 'needs-install'
    ? '需要先安装 goofish-cli 组件'
    : status.auth.error
      ? `登录态加载失败：${status.auth.error}`
      : '尚未登录任何闲鱼账号——下方点「扫码登录（推荐）」';

  return (
    <div className="border-b border-amber-500/20 bg-amber-500/5">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 sm:px-8">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="size-3.5 text-amber-600" />
          <span className="text-amber-900 dark:text-amber-200">
            {status.phase === 'needs-install' ? '尚未安装' : '尚未登录'}
          </span>
          <span className="text-xs text-muted-foreground">· {message}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw />
          刷新
        </Button>
      </div>
    </div>
  );
}

interface SetupSectionProps {
  status: GoofishAssistantStatus | null;
  onStatusRefresh: () => void;
  defaultExpanded: boolean;
}

export function SetupSection({
  status,
  onStatusRefresh,
  defaultExpanded,
}: SetupSectionProps): React.ReactElement {
  const auth = useGoofishAuth();
  const [open, setOpen] = React.useState<boolean>(defaultExpanded);
  const [browserModalOpen, setBrowserModalOpen] = React.useState(false);

  React.useEffect(() => {
    if (auth.busy === 'login') {
      setBrowserModalOpen(true);
    } else {
      setBrowserModalOpen(false);
    }
  }, [auth.busy]);
  // Refresh app-level status whenever the embedded login flow finishes a
  // mutation, so the wider shell collapses the section automatically once
  // an account turns valid.
  const lastBusy = React.useRef<typeof auth.busy>(null);
  React.useEffect(() => {
    if (lastBusy.current && !auth.busy) {
      onStatusRefresh();
    }
    lastBusy.current = auth.busy;
  }, [auth.busy, onStatusRefresh]);

  const accounts = status?.auth.accounts ?? [];
  const loggedInCount = status?.auth.loggedInCount ?? 0;
  const installed = !!status?.install.installed;
  const ready = !!status?.ready;
  const headline = ready ? '已就绪' : '数据授权';

  React.useEffect(() => {
    if (!ready) setOpen(true);
  }, [ready]);

  return (
    <>
    <GoofishLoginBrowserModal
      open={browserModalOpen}
      onClose={() => setBrowserModalOpen(false)}
    />
    <div className="rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <span className="text-base font-semibold tracking-tight">{headline}</span>
          {ready ? (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              · {loggedInCount} 个账号在线
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
      <div className="grid gap-4 border-t bg-background/40 p-5 xl:grid-cols-[0.6fr_1.4fr]">
        <div className="flex flex-col gap-3">
          <StatusRow ok={installed} value={installed ? '已安装' : '未安装'} label="goofish-cli" />
          <StatusRow ok={accounts.length > 0} value={`${accounts.length}`} label="账号目录" />
          <StatusRow ok={loggedInCount > 0} value={`${loggedInCount}`} label="在线账号" />
          <Button variant="ghost" size="sm" onClick={onStatusRefresh} className="w-fit">
            <RefreshCw />
            刷新
          </Button>
          {status?.install.error ? (
            <Alert>
              <AlertCircle />
              <AlertDescription className="text-xs leading-5">
                {status.install.error}
              </AlertDescription>
            </Alert>
          ) : null}
          {status?.auth.error ? (
            <Alert>
              <AlertCircle />
              <AlertDescription className="text-xs leading-5">
                {status.auth.error}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <div className="min-w-0">
          <GoofishLoginForm
            hasOtherAccounts={loggedInCount > 0}
            busy={auth.busy}
            onLogin={(input) => void auth.login(input)}
          />
          {auth.actionMessage ? (
            <Alert
              className={cn(
                'mt-4',
                auth.actionMessage.kind === 'error'
                  ? 'border-rose-500/50'
                  : 'border-emerald-500/40',
              )}
            >
              <AlertDescription>{auth.actionMessage.text}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
      ) : null}
    </div>
    </>
  );
}

function StatusRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {ok ? (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        ) : (
          <AlertCircle className="size-3.5 text-muted-foreground" />
        )}
        {label}
      </span>
      <span className={cn('font-medium', ok ? 'text-foreground' : 'text-muted-foreground')}>
        {value}
      </span>
    </div>
  );
}
