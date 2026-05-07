'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Box } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { AppCard, AppCardActions, AppCardMeta, StatusDot } from './AppCard';

interface ListedApp {
  id: string;
  name: string;
  version: string;
  source: string;
  enabled: boolean;
  installedAt: number;
  lastUsedAt: number | null;
  sizeBytes: number | null;
}

export function InstalledAppCard({
  app,
  onUninstall,
}: {
  app: ListedApp;
  onUninstall: (id: string) => void;
}): React.ReactElement {
  return (
    <AppCard muted={!app.enabled}>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Box className="size-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">{app.name}</p>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              v{app.version}
            </span>
          </div>
        </div>
      </div>
      <AppCardMeta>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={app.enabled ? 'ok' : 'idle'} />
          {app.enabled ? '可用' : '已禁用'}
        </span>
        <span>·</span>
        <span>{labelSource(app.source)}</span>
        <span>·</span>
        <span>{app.lastUsedAt ? formatRelative(app.lastUsedAt) : '未使用'}</span>
      </AppCardMeta>
      <AppCardActions>
        <Button asChild size="sm" variant="ghost" className="-ml-2">
          <Link href={`/apps/${app.id}`} className="inline-flex items-center gap-1">
            打开
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onUninstall(app.id)}
        >
          卸载
        </Button>
      </AppCardActions>
    </AppCard>
  );
}

function labelSource(s: string): string {
  switch (s) {
    case 'ai-generated':
      return 'AI 生成';
    case 'workflow-promoted':
      return '工作流';
    case 'local':
      return '本地';
    case 'builtin':
      return '内置';
    case 'market':
      return '市场';
    default:
      return s;
  }
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.round(months / 12)} 年前`;
}
