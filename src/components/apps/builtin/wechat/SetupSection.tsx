'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import { WeChatExportPanel } from '@/components/wechat-export/WeChatExportPanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { WeChatAssistantStatus } from './wechat-types';

export function SetupBanner({
  status,
  onRefresh,
  onOpenDetails,
  expanded,
}: {
  status: WeChatAssistantStatus | null;
  onRefresh: () => void;
  onOpenDetails: () => void;
  expanded: boolean;
}): React.ReactElement | null {
  if (!status) return null;
  if (status.export.ready) return null;

  return (
    <div className="border-b border-amber-500/20 bg-amber-500/5">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 sm:px-8">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="size-3.5 text-amber-600" />
          <span className="text-amber-900 dark:text-amber-200">尚未授权</span>
          {status.export.message ? (
            <span className="text-xs text-muted-foreground">· {status.export.message}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw />
            刷新
          </Button>
          <Button variant="default" size="sm" onClick={onOpenDetails}>
            {expanded ? '收起' : '授权'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SetupSection({
  status,
  onStatusRefresh,
  defaultExpanded,
}: {
  status: WeChatAssistantStatus | null;
  onStatusRefresh: () => void;
  defaultExpanded: boolean;
}): React.ReactElement {
  return (
    <details
      open={defaultExpanded}
      className="group rounded-xl border"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <span className="text-base font-semibold tracking-tight">数据授权</span>
        </div>
        <span className="text-xs text-muted-foreground group-open:hidden">展开</span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">收起</span>
      </summary>
      <div className="grid gap-4 border-t bg-background/40 p-5 xl:grid-cols-[0.6fr_1.4fr]">
        <div className="flex flex-col gap-3">
          <StatusRow ok={!!status?.export.supported} value={status?.export.supported ? 'macOS' : '不支持'} label="平台" />
          <StatusRow ok={!!status?.export.keyCount} value={`${status?.export.keyCount ?? 0}`} label="密钥" />
          <StatusRow ok={!!status?.export.mcp?.enabled} value={status?.export.mcp?.enabled ? '已启用' : '未启用'} label="读取服务" />
          <StatusRow ok={status?.im.enabled ?? false} value={status?.im.enabled ? '已启用' : '未启用'} label="IM 路由" />
          {status?.im.routedSessionId ? (
            <Button asChild variant="outline" size="sm" className="w-fit">
              <Link href={`/main-agent/${status.im.routedSessionId}`}>打开路由会话</Link>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onStatusRefresh} className="w-fit">
            <RefreshCw />
            刷新
          </Button>
          {status?.export.message && !status.export.ready ? (
            <Alert>
              <AlertCircle />
              <AlertDescription className="text-xs leading-5">
                {status.export.message}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <div className="min-w-0">
          <WeChatExportPanel />
        </div>
      </div>
    </details>
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
