'use client';

import * as React from 'react';

import { runEventDsl } from '../dispatch';
import type { LayoutProps } from '../PageRenderer';
import { ResultRenderer } from '../widgets/display/ResultRenderer';

export function ResultLayout({ page, bridge, inputs, recordStepOutput }: LayoutProps): React.ReactElement {
  const source = page.source as { run: string; input?: Record<string, unknown> } | undefined;
  const render = page.render ?? 'markdown';
  const [result, setResult] = React.useState<unknown>(undefined);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!source) return;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      const r = await runEventDsl(
        source!.run,
        { inputs: { ...inputs, ...(source!.input ?? {}) } },
        bridge,
        {
          onWorkflowResult: (id, output, status) => {
            if (status === 'success') recordStepOutput(id, output);
          },
        },
      );
      if (cancelled) return;
      if (!r.ok) setError(r.error);
      else setResult(r.result);
      setLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [source, bridge, inputs, recordStepOutput]);

  return (
    <div className="flex flex-col gap-4 p-6">
      {page.title ? <h1 className="text-xl font-semibold">{page.title}</h1> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">运行中…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <ResultRenderer render={render} value={result} />
      )}
    </div>
  );
}
