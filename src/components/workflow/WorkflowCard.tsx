'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';

interface WorkflowCardProps {
  id: string;
  name: string;
  description: string;
  dslVersion: string;
  stepCount: number;
  updatedAt: string;
  onDeleted: (id: string) => void;
  onRun?: (id: string) => void;
  onSchedule?: (id: string) => void;
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return '刚刚';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} 小时前`;
  return `${Math.floor(ms / 86400_000)} 天前`;
}

const VERSION_COLORS: Record<string, string> = {
  v2: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  v1: 'bg-slate-500/10 text-slate-500',
};

export function WorkflowCard({ id, name, description, dslVersion, stepCount, updatedAt, onDeleted, onRun, onSchedule }: WorkflowCardProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`确认删除「${name}」？`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workflow/definitions/${id}`, { method: 'DELETE' });
      if (res.ok) onDeleted(id);
    } finally {
      setDeleting(false);
    }
  }, [id, name, onDeleted]);

  const versionClass = VERSION_COLORS[dslVersion] ?? VERSION_COLORS.v1;

  return (
    <Link
      href={`/workflow/${id}`}
      className="group relative flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5 transition-all hover:border-border hover:shadow-md hover:shadow-black/5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug line-clamp-2 flex-1">{name}</h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${versionClass}`}>
          {dslVersion}
        </span>
      </div>

      {/* Description */}
      {description ? (
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{description}</p>
      ) : (
        <p className="text-xs text-muted-foreground/50 italic">暂无描述</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-1 border-t border-border/30">
        <span className="text-[10px] text-muted-foreground">{stepCount} 步骤 · {formatRelativeTime(updatedAt)}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onRun && (
            <Button
              variant="ghost" size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onRun(id); }}
            >
              运行
            </Button>
          )}
          {onSchedule && (
            <Button
              variant="ghost" size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onSchedule(id); }}
            >
              定时
            </Button>
          )}
          <Button
            variant="ghost" size="sm"
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? '...' : '删除'}
          </Button>
        </div>
      </div>
    </Link>
  );
}
