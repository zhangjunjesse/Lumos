'use client';

import * as React from 'react';

import { useResolvedTemplate } from '../../binding-context';

export function ActionLink({
  widget,
  onAction,
}: {
  widget: { type: 'link'; label: string; open: string };
  onAction: (
    event: 'run' | 'open',
    dsl: string,
    payload?: { rowId?: string; data?: Record<string, unknown> },
  ) => Promise<void>;
}): React.ReactElement {
  const label = useResolvedTemplate(widget.label);
  return (
    <button
      type="button"
      className="text-primary underline-offset-4 hover:underline"
      onClick={() => {
        void onAction('open', widget.open);
      }}
    >
      {label}
    </button>
  );
}
