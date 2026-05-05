'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export function AppCard({
  children,
  className,
  muted,
  dashed,
}: {
  children: React.ReactNode;
  className?: string;
  muted?: boolean;
  dashed?: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex h-full flex-col gap-3 rounded-xl bg-card p-4 transition-colors',
        dashed
          ? 'border border-dashed hover:border-foreground/30'
          : 'ring-1 ring-border hover:ring-foreground/20',
        muted && 'opacity-60',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AppCardHeader({
  title,
  right,
  subtitle,
}: {
  title: string;
  right?: React.ReactNode;
  subtitle?: string;
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {subtitle ? (
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
        <p className={cn('truncate font-medium', subtitle ? 'mt-0.5 text-base' : 'text-sm')}>
          {title}
        </p>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function AppCardMeta({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

export function AppCardActions({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
      {children}
    </div>
  );
}

export function StatusDot({
  tone,
}: {
  tone: 'ok' | 'warn' | 'idle';
}): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-block size-1.5 rounded-full',
        tone === 'ok' && 'bg-emerald-500',
        tone === 'warn' && 'bg-amber-500',
        tone === 'idle' && 'bg-muted-foreground/40',
      )}
    />
  );
}
