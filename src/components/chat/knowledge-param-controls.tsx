'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

export function ParamRow({
  label,
  isOverridden,
  children,
}: {
  label: string;
  isOverridden: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div
          className={cn(
            'text-[11px]',
            isOverridden ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
          )}
        >
          {isOverridden
            ? t('messageInput.knowledgeOverridden')
            : t('messageInput.knowledgeFollowingDefault')}
        </div>
      </div>
      {children}
    </div>
  );
}

export function ModeButton({
  label,
  active,
  isOverride,
  isDefault,
  onClick,
}: {
  label: string;
  active: boolean;
  isOverride: boolean;
  isDefault: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors',
        active
          ? isOverride
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-primary/40 bg-primary/5'
          : 'border-border bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      {isDefault && <DefaultDot />}
    </button>
  );
}

export function RewriteSwitch({
  enabled,
  isOverride,
  onToggle,
}: {
  enabled: boolean;
  isOverride: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
        enabled
          ? isOverride
            ? 'border-emerald-500/40 bg-emerald-500/20'
            : 'border-primary/40 bg-primary/20'
          : 'border-border bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-3 w-3 rounded-full bg-background shadow-sm transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-1',
        )}
      />
    </button>
  );
}

export function ChipRow({
  options,
  active,
  override,
  defaultValue,
  onPick,
}: {
  options: ReadonlyArray<number>;
  active: number;
  override: number | undefined;
  defaultValue: number;
  onPick: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((value) => {
        const isActive = active === value;
        const isOverride = override !== undefined && override === value;
        const isDefault = defaultValue === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onPick(value)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
              isActive
                ? isOverride
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-primary/40 bg-primary/5 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            <span>{value}</span>
            {isDefault && <DefaultDot />}
          </button>
        );
      })}
    </div>
  );
}

export function DefaultDot() {
  return (
    <span
      className="inline-block h-1 w-1 shrink-0 rounded-full bg-primary/70"
      aria-label="default"
    />
  );
}
