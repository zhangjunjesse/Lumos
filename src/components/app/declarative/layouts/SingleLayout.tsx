'use client';

import * as React from 'react';

import { runEventDsl } from '../dispatch';
import type { LayoutProps } from '../PageRenderer';
import { WidgetRenderer } from '../WidgetRenderer';

export function SingleLayout({ page, bridge, refreshDb, recordStepOutput, inputs }: LayoutProps): React.ReactElement {
  const blocks = (page.blocks ?? []) as Array<Record<string, unknown> & { type: string }>;

  const onAction = React.useCallback<
    React.ComponentProps<typeof WidgetRenderer>['onAction']
  >(
    async (kind, dsl, payload) => {
      const result = await runEventDsl(
        dsl,
        { inputs, ...payload },
        bridge,
        {
          onWorkflowResult: (id, output, status) => {
            if (status === 'success') {
              recordStepOutput(id, output);
            }
          },
          onDbMutation: () => {
            void refreshDb();
          },
        },
      );
      if (!result.ok) {
        bridge.toast({ title: '操作失败', description: result.error, level: 'error' });
      }
      void kind;
    },
    [bridge, inputs, refreshDb, recordStepOutput],
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      {page.title ? <h1 className="text-xl font-semibold">{page.title}</h1> : null}
      {page.description ? (
        <p className="text-sm text-muted-foreground">{page.description}</p>
      ) : null}
      {blocks.map((block, i) => (
        <WidgetRenderer key={i} widget={block} bridge={bridge} onAction={onAction} />
      ))}
    </div>
  );
}
