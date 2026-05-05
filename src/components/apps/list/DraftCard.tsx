'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { AppCard, AppCardActions, AppCardMeta, StatusDot } from './AppCard';

interface ListedDraft {
  sessionId: string;
  name: string;
  description: string;
  status: string;
  updatedAt: number;
}

export function DraftCard({
  draft,
  onDelete,
}: {
  draft: ListedDraft;
  onDelete: (sessionId: string) => void;
}): React.ReactElement {
  return (
    <AppCard dashed>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileText className="size-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">{draft.name || '未命名'}</p>
            <span className="shrink-0 text-xs text-muted-foreground">草稿</span>
          </div>
        </div>
      </div>
      {draft.description ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {draft.description}
        </p>
      ) : null}
      <AppCardMeta>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone="idle" />
          {formatRelative(draft.updatedAt)}
        </span>
      </AppCardMeta>
      <AppCardActions>
        <Button asChild size="sm" variant="ghost" className="-ml-2">
          <Link href={`/apps/builder/${draft.sessionId}`} className="inline-flex items-center gap-1">
            继续
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onDelete(draft.sessionId)}
        >
          删除
        </Button>
      </AppCardActions>
    </AppCard>
  );
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
