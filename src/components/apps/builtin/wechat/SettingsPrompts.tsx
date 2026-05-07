'use client';

import * as React from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  DEFAULT_PROMPTS,
  PROMPT_METAS,
  PROMPT_ORDER,
  type PromptKey,
} from './default-prompts';

export function SettingsPrompts({
  prompts,
  onChange,
}: {
  prompts: Record<PromptKey, string>;
  onChange: (key: PromptKey, value: string) => void;
}): React.ReactElement {
  const [openKey, setOpenKey] = React.useState<PromptKey | null>(null);

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card">
      {PROMPT_ORDER.map((key, i) => {
        const meta = PROMPT_METAS[key];
        const value = prompts[key];
        const isModified = value !== DEFAULT_PROMPTS[key];
        const isOpen = openKey === key;
        return (
          <div key={key} className={cn('flex flex-col', i > 0 && 'border-t')}>
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : key)}
              className="flex items-start justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="text-sm font-medium">{meta.title}</p>
                  {isModified ? (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      已修改
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
              </div>
              <ChevronRight
                className={cn(
                  'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
                  isOpen && 'rotate-90',
                )}
              />
            </button>
            {isOpen ? (
              <PromptEditor
                value={value}
                defaultValue={DEFAULT_PROMPTS[key]}
                variables={meta.variables}
                onChange={(v) => onChange(key, v)}
                onReset={() => onChange(key, DEFAULT_PROMPTS[key])}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PromptEditor({
  value,
  defaultValue,
  variables,
  onChange,
  onReset,
}: {
  value: string;
  defaultValue: string;
  variables: string[];
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const isModified = value !== defaultValue;
  return (
    <div className="flex flex-col gap-3 border-t bg-muted/20 px-5 py-4">
      {variables.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>变量（运行时被替换，不要删）:</span>
          {variables.map((v) => (
            <code
              key={v}
              className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-border"
            >
              {v}
            </code>
          ))}
        </div>
      ) : null}
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(20, Math.max(8, value.split('\n').length))}
        className="font-mono text-[12px] leading-relaxed"
        spellCheck={false}
      />
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="tabular-nums">{value.length} 字符 · {value.split('\n').length} 行</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={!isModified}
          className="h-7 px-2 text-xs"
        >
          <RotateCcw className="size-3" />
          重置为默认
        </Button>
      </div>
    </div>
  );
}
