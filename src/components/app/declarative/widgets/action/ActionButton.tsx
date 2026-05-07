'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';

import { useResolveExpression, useResolvedTemplate } from '../../binding-context';

interface ActionButtonSpec {
  type: 'button';
  label: string;
  primary?: boolean;
  run?: string;
  open?: string;
  input?: Record<string, unknown>;
  confirm?: boolean | string;
  /** Template binding string evaluated at render time. */
  disabled?: string;
}

export function ActionButton({
  widget,
  onAction,
}: {
  widget: ActionButtonSpec;
  onAction: (
    event: 'run' | 'open',
    dsl: string,
    payload?: { rowId?: string; data?: Record<string, unknown> },
  ) => Promise<void>;
}): React.ReactElement {
  const label = useResolvedTemplate(widget.label);
  const resolveExpr = useResolveExpression();
  const disabled = widget.disabled
    ? Boolean(disabledFromTemplate(widget.disabled, resolveExpr))
    : false;

  const handler = async () => {
    const dsl = widget.run ?? widget.open;
    if (!dsl) return;
    if (widget.confirm) {
      // Lightweight inline confirm using window.confirm — pages that need richer
      // confirmation use the bridge.confirm() path inside the layout.
      const msg = typeof widget.confirm === 'string' ? widget.confirm : '确定执行该操作？';
      if (typeof window !== 'undefined' && !window.confirm(msg)) return;
    }
    await onAction(widget.run ? 'run' : 'open', dsl, widget.input ? { data: widget.input } : undefined);
  };

  return (
    <div>
      <Button
        type="button"
        variant={widget.primary ? 'default' : 'outline'}
        disabled={disabled}
        onClick={handler}
      >
        {label}
      </Button>
    </div>
  );
}

function disabledFromTemplate(template: string, resolve: (expr: string) => unknown): unknown {
  // Single-binding {{ x }} → return the raw boolean.
  const m = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(template);
  if (m) return resolve(m[1]);
  return false;
}
