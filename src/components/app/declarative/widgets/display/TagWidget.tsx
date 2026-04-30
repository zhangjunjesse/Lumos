'use client';

import * as React from 'react';

import { useResolvedTemplate } from '../../binding-context';

const COLORS = {
  default: 'border-border text-foreground',
  primary: 'border-primary text-primary',
  success: 'border-green-500 text-green-700 dark:text-green-400',
  warning: 'border-yellow-500 text-yellow-700 dark:text-yellow-400',
  danger: 'border-destructive text-destructive',
} as const;

export function TagWidget({
  widget,
}: {
  widget: { type: 'tag'; value: string; color?: keyof typeof COLORS };
}): React.ReactElement {
  const text = useResolvedTemplate(widget.value);
  const color = widget.color ?? 'default';
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${COLORS[color]}`}
    >
      {text}
    </span>
  );
}
