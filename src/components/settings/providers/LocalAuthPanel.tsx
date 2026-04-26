'use client';

import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { getLocalAuthBadge, type LocalAuthState } from './useLocalAuth';

interface Props {
  configId: string;
  auth: LocalAuthState;
}

export function LocalAuthPanel({ configId, auth }: Props) {
  const badge = getLocalAuthBadge(auth.statuses[configId]);
  const loading = auth.loadingId === configId;
  const status = auth.statuses[configId];

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Claude 本地登录状态</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            检测 Lumos 内置环境的 Claude 登录状态。
          </p>
        </div>
        <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
          {loading ? '检测中' : badge.label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8"
          onClick={() => auth.refresh(configId)} disabled={loading}>
          {loading && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
          重新检测
        </Button>
        <Button type="button" size="sm" className="h-8"
          onClick={() => auth.startLogin(configId)} disabled={loading}>
          {loading && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
          登录 / 重新登录
        </Button>
      </div>
      {status?.configDir && (
        <p className="text-[11px] text-muted-foreground/80 break-all leading-relaxed">
          配置目录：{status.configDir}
        </p>
      )}
      {status?.error && <p className="text-xs text-destructive">{status.error}</p>}
      {auth.actionMessage && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{auth.actionMessage}</p>
      )}
      {auth.actionError && <p className="text-xs text-destructive">{auth.actionError}</p>}
    </div>
  );
}
