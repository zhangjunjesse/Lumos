'use client';

import * as React from 'react';

import type { RendererBridge } from './bridge';
import { ActionButton } from './widgets/action/ActionButton';
import { ActionLink } from './widgets/action/ActionLink';
import { CardWidget } from './widgets/container/CardWidget';
import { BadgeWidget } from './widgets/display/BadgeWidget';
import { MarkdownWidget } from './widgets/display/MarkdownWidget';
import { TableWidget } from './widgets/display/TableWidget';
import { TagWidget } from './widgets/display/TagWidget';

/**
 * Dispatches a widget JSON node from `single.blocks[]` to its React
 * component. Form fields use a separate dispatcher inside the form layout.
 */

export interface WidgetRendererProps {
  widget: Record<string, unknown> & { type: string };
  bridge: RendererBridge;
  onAction: (
    event: 'run' | 'open',
    dsl: string,
    payload?: { rowId?: string; data?: Record<string, unknown> },
  ) => Promise<void>;
}

export function WidgetRenderer({ widget, bridge, onAction }: WidgetRendererProps): React.ReactElement {
  switch (widget.type) {
    case 'card':
      return <CardWidget widget={widget as never} bridge={bridge} onAction={onAction} />;
    case 'markdown':
      return <MarkdownWidget widget={widget as never} />;
    case 'table':
      return <TableWidget widget={widget as never} bridge={bridge} onAction={onAction} />;
    case 'tag':
      return <TagWidget widget={widget as never} />;
    case 'badge':
      return <BadgeWidget widget={widget as never} />;
    case 'button':
      return <ActionButton widget={widget as never} onAction={onAction} />;
    case 'link':
      return <ActionLink widget={widget as never} onAction={onAction} />;
    default:
      return (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Unknown widget type: <code>{String(widget.type)}</code>
        </div>
      );
  }
}
