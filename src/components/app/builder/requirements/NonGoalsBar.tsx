'use client';

import * as React from 'react';
import { Ban, Plus, X } from 'lucide-react';

import { Input } from '@/components/ui/input';

interface NonGoalsBarProps {
  items: string[];
  saving: boolean;
  onChange: (next: string[]) => void;
}

export function NonGoalsBar({ items, saving, onChange }: NonGoalsBarProps): React.ReactElement {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  const commit = () => {
    const value = draft.trim();
    if (!value) {
      setAdding(false);
      setDraft('');
      return;
    }
    if (!items.includes(value)) {
      onChange([...items, value]);
    }
    setDraft('');
    setAdding(false);
  };

  const cancel = () => {
    setAdding(false);
    setDraft('');
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed bg-muted/15 px-3 py-2">
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Ban className="size-3" />
        不做的
      </span>

      {items.length === 0 && !adding ? (
        <span className="text-[11px] text-muted-foreground/60">
          告诉 AI 哪些不要做（例：不要登录、不要导出）
        </span>
      ) : null}

      {items.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[11px] text-foreground/80 ring-1 ring-border"
        >
          {item}
          <button
            type="button"
            onClick={() => handleRemove(index)}
            disabled={saving}
            className="rounded-full text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            aria-label={`删除「${item}」`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      {adding ? (
        <Input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          placeholder="例如：不要登录"
          maxLength={60}
          className="h-6 w-44 rounded-full border-input bg-background px-2.5 py-0 text-[11px] shadow-none focus-visible:ring-1"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary disabled:opacity-50"
        >
          <Plus className="size-3" />
          添加
        </button>
      )}
    </div>
  );
}
