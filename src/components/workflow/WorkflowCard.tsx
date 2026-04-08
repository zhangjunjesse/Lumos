'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface WorkflowCardProps {
  id: string;
  name: string;
  description: string;
  dslVersion: string;
  stepCount: number;
  updatedAt: string;
  groupName: string;
  existingGroups: string[];
  onDeleted: (id: string) => void;
  onGroupChange: (id: string, groupName: string) => void;
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

export function WorkflowCard({ id, name, description, dslVersion, stepCount, updatedAt, groupName, existingGroups, onDeleted, onGroupChange, onRun, onSchedule }: WorkflowCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupInput, setGroupInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleGroupOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setGroupInput('');
    setGroupOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const applyGroup = (e: React.MouseEvent, value: string) => {
    e.preventDefault();
    e.stopPropagation();
    onGroupChange(id, value);
    setGroupOpen(false);
  };

  const handleInputConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const value = groupInput.trim();
    if (value) {
      onGroupChange(id, value);
      setGroupOpen(false);
    }
  };

  const otherGroups = existingGroups.filter(g => g !== groupName);
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
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] text-muted-foreground shrink-0">{stepCount} 步骤 · {formatRelativeTime(updatedAt)}</span>
          {groupName && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground truncate max-w-[80px]">
              {groupName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {onRun && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onRun(id); }}>
              运行
            </Button>
          )}
          {onSchedule && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onSchedule(id); }}>
              定时
            </Button>
          )}
          <Popover open={groupOpen} onOpenChange={setGroupOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={handleGroupOpen}>
                分组
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-2" onClick={e => e.preventDefault()}>
              <p className="text-[10px] text-muted-foreground px-1 mb-1.5">移至分组</p>
              {otherGroups.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {otherGroups.map(g => (
                    <button key={g}
                      className="text-[11px] px-2 py-1 rounded-md bg-accent hover:bg-accent/80 transition-colors"
                      onClick={e => applyGroup(e, g)}>
                      {g}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-1">
                <Input
                  ref={inputRef}
                  value={groupInput}
                  onChange={e => setGroupInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleInputConfirm(e as unknown as React.MouseEvent); }}
                  placeholder="新分组名称"
                  className="h-7 text-xs"
                />
                <Button size="sm" className="h-7 px-2 text-xs shrink-0" onClick={handleInputConfirm}>
                  确定
                </Button>
              </div>
              {groupName && (
                <button className="mt-1.5 w-full text-left text-[11px] px-1 py-1 text-muted-foreground hover:text-destructive transition-colors"
                  onClick={e => applyGroup(e, '')}>
                  清除分组
                </button>
              )}
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
            onClick={handleDelete} disabled={deleting}>
            {deleting ? '...' : '删除'}
          </Button>
        </div>
      </div>
    </Link>
  );
}
