'use client';

import * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { RendererBridge } from '../../bridge';
import { WidgetRenderer } from '../../WidgetRenderer';

export function CardWidget({
  widget,
  bridge,
  onAction,
}: {
  widget: {
    type: 'card';
    title?: string;
    children?: Array<Record<string, unknown> & { type: string }>;
  };
  bridge: RendererBridge;
  onAction: React.ComponentProps<typeof WidgetRenderer>['onAction'];
}): React.ReactElement {
  return (
    <Card>
      {widget.title ? (
        <CardHeader>
          <CardTitle>{widget.title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className="flex flex-col gap-3">
        {(widget.children ?? []).map((child, i) => (
          <WidgetRenderer key={i} widget={child} bridge={bridge} onAction={onAction} />
        ))}
      </CardContent>
    </Card>
  );
}
