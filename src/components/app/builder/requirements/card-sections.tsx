'use client';

import * as React from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { BuilderStory } from '@/lib/app/builder/session';
import { cn } from '@/lib/utils';

export function DetailChip({
  icon: Icon,
  label,
  count,
  open,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  open: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-colors',
        open
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="size-3" />
      <span>{label}</span>
      {count > 0 ? (
        <span
          className={cn(
            'inline-flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums',
            open ? 'bg-primary/20 text-primary' : 'bg-muted-foreground/15 text-muted-foreground',
          )}
        >
          {count}
        </span>
      ) : null}
      {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
    </button>
  );
}

export function AcceptanceList({
  items,
  onChange,
  onBlurSave,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  onBlurSave: () => void;
}): React.ReactElement {
  const handleAdd = () => onChange([...items, '']);
  const handleUpdate = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };
  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
    onBlurSave();
  };

  return (
    <div className="mt-3 flex flex-col gap-1 rounded-lg border bg-muted/10 p-2">
      {items.length === 0 ? (
        <div className="px-2 py-1 text-[11px] text-muted-foreground/70">还没有验收条件</div>
      ) : null}
      {items.map((item, index) => (
        <div
          key={index}
          className="group/criterion flex items-start gap-2 rounded px-2 py-1 transition-colors focus-within:bg-background"
        >
          <CheckCircle2 className="mt-1 size-3 shrink-0 text-muted-foreground/40 group-focus-within/criterion:text-primary" />
          <Textarea
            value={item}
            onChange={(event) => handleUpdate(index, event.target.value)}
            onBlur={onBlurSave}
            placeholder="例如：用户可以新建一条客户记录"
            rows={1}
            className="min-h-0 resize-none border-0 bg-transparent p-0 text-xs leading-5 shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={() => handleRemove(index)}
            className="invisible mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover/criterion:visible"
            aria-label="删除验收条件"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={handleAdd}
        className="mt-0.5 flex items-center gap-1.5 self-start rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
      >
        <Plus className="size-3" />
        添加验收
      </button>
    </div>
  );
}

export function AdvancedFields({
  story,
  onChange,
  onBlurSave,
}: {
  story: BuilderStory;
  onChange: (patch: Partial<BuilderStory>) => void;
  onBlurSave: () => void;
}): React.ReactElement {
  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded-lg border bg-muted/10 p-2.5">
      <InlineRow
        label="角色"
        value={story.actor ?? ''}
        placeholder="谁会使用"
        onChange={(value) => onChange({ actor: value })}
        onBlurSave={onBlurSave}
      />
      <InlineRow
        label="目标"
        value={story.goal ?? ''}
        placeholder="要完成什么"
        onChange={(value) => onChange({ goal: value })}
        onBlurSave={onBlurSave}
      />
      <InlineRow
        label="价值"
        value={story.benefit ?? ''}
        placeholder="得到什么结果"
        onChange={(value) => onChange({ benefit: value })}
        onBlurSave={onBlurSave}
      />
    </div>
  );
}

function InlineRow({
  label,
  value,
  placeholder,
  onChange,
  onBlurSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlurSave: () => void;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlurSave}
        placeholder={placeholder}
        className="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
      />
    </label>
  );
}

export function countAdvanced(story: BuilderStory): number {
  return (story.actor ? 1 : 0) + (story.goal ? 1 : 0) + (story.benefit ? 1 : 0);
}
