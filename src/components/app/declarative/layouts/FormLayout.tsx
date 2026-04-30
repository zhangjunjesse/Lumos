'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';

import { runEventDsl } from '../dispatch';
import type { LayoutProps } from '../PageRenderer';
import { FormFieldRenderer } from '../widgets/form/FormFieldRenderer';
import { ResultRenderer } from '../widgets/display/ResultRenderer';

export function FormLayout({
  page,
  bridge,
  inputs,
  setInputs,
  refreshDb,
  recordStepOutput,
}: LayoutProps): React.ReactElement {
  const fields = React.useMemo(
    () => (page.form ?? []) as Array<Record<string, unknown>>,
    [page.form],
  );
  const submit = page.submit as
    | { label: string; run: string; render?: 'markdown' | 'json' | 'table' | 'text' | 'none'; input?: Record<string, unknown> }
    | undefined;

  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  const setField = React.useCallback(
    (name: string, value: unknown) => {
      setInputs((prev) => ({ ...prev, [name]: value }));
    },
    [setInputs],
  );

  const handleSubmit = React.useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!submit) return;
      const missingRequired = (fields as Array<{ required?: boolean; name: string }>).find(
        (f) => f.required && (inputs[f.name] === undefined || inputs[f.name] === ''),
      );
      if (missingRequired) {
        setError(`必填字段缺失：${missingRequired.name}`);
        return;
      }
      setError(null);
      setSubmitting(true);
      try {
        const r = await runEventDsl(
          submit.run,
          { inputs: { ...inputs, ...(submit.input ?? {}) } },
          bridge,
          {
            onWorkflowResult: (id, output, status) => {
              if (status === 'success') {
                recordStepOutput(id, output);
                setResult(output);
              }
            },
            onDbMutation: () => {
              void refreshDb();
            },
          },
        );
        if (!r.ok) {
          setError(r.error);
        } else if (r.result !== undefined) {
          setResult(r.result);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [bridge, fields, inputs, refreshDb, recordStepOutput, submit],
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      {page.title ? <h1 className="text-xl font-semibold">{page.title}</h1> : null}
      {page.description ? (
        <p className="text-sm text-muted-foreground">{page.description}</p>
      ) : null}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-2xl">
        {fields.map((field, i) => (
          <FormFieldRenderer
            key={(field.name as string) ?? i}
            field={field}
            value={inputs[field.name as string]}
            onChange={(v) => setField(field.name as string, v)}
          />
        ))}
        {submit ? (
          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? '处理中…' : submit.label}
            </Button>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
      {submit?.render && submit.render !== 'none' && result !== undefined ? (
        <div className="border-t pt-6">
          <ResultRenderer render={submit.render} value={result} />
        </div>
      ) : null}
    </div>
  );
}
