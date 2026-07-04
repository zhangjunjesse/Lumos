'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';

import type { KeywordStatus, RunStatus } from './types';
import { KEYWORD_STATUS_TEXT, RUN_STATUS_TEXT } from './types';

const KEYWORD_TONES: Record<KeywordStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  no_results: 'bg-muted text-muted-foreground',
  blocked: 'bg-red-500/15 text-red-700 dark:text-red-400',
  parse_failed: 'bg-amber-500/15 text-amber-700 dark:text-amber-500',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
};

const RUN_TONES: Record<RunStatus, string> = {
  running: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  partial: 'bg-amber-500/15 text-amber-700 dark:text-amber-500',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
};

export function StatusBadge(props: {
  kind: 'run' | 'keyword';
  status: string;
  title?: string;
}): React.ReactElement {
  const text =
    props.kind === 'run'
      ? RUN_STATUS_TEXT[props.status as RunStatus] ?? props.status
      : KEYWORD_STATUS_TEXT[props.status as KeywordStatus] ?? props.status;
  const tone =
    props.kind === 'run'
      ? RUN_TONES[props.status as RunStatus] ?? 'bg-muted text-muted-foreground'
      : KEYWORD_TONES[props.status as KeywordStatus] ?? 'bg-muted text-muted-foreground';

  return (
    <Badge variant="secondary" className={`${tone} font-normal`} title={props.title}>
      {text}
    </Badge>
  );
}
