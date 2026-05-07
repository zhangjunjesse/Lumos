'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';

import { useResolvedProp } from '../binding-context';
import { runEventDsl } from '../dispatch';
import type { LayoutProps } from '../PageRenderer';
import { FormFieldRenderer } from '../widgets/form/FormFieldRenderer';
import { ResultRenderer } from '../widgets/display/ResultRenderer';
import { TableWidget } from '../widgets/display/TableWidget';

interface DetailFormView {
  form: Array<Record<string, unknown>>;
  submit?: { label: string; run: string };
}

interface DetailTableView {
  type: 'table';
  data: string;
}

interface DetailResultView {
  type: 'result';
  run: string;
  input?: Record<string, unknown>;
  render: 'markdown' | 'json' | 'table' | 'text';
}

interface DetailTab {
  label: string;
  view: DetailFormView | DetailTableView | DetailResultView;
}

interface Detail {
  tabs?: DetailTab[];
  view?: DetailFormView | DetailTableView | DetailResultView;
}

export function ListDetailLayout({
  page,
  bridge,
  inputs,
  setInputs,
  refreshDb,
  recordStepOutput,
}: LayoutProps): React.ReactElement {
  const list = page.list as Record<string, unknown> & { type: 'table'; data: string } | undefined;
  const detail = page.detail as Detail | undefined;

  const [selectedRow, setSelectedRow] = React.useState<Record<string, unknown> | null>(null);

  const onAction = React.useCallback<
    React.ComponentProps<typeof TableWidget>['onAction']
  >(
    async (_kind, dsl, payload) => {
      const r = await runEventDsl(
        dsl,
        { inputs, rowId: payload?.rowId, data: payload?.data },
        bridge,
        {
          onWorkflowResult: (id, output, status) => {
            if (status === 'success') recordStepOutput(id, output);
          },
          onDbMutation: () => {
            void refreshDb();
          },
        },
      );
      if (!r.ok) bridge.toast({ title: '操作失败', description: r.error, level: 'error' });
    },
    [bridge, inputs, refreshDb, recordStepOutput],
  );

  return (
    <div className="grid h-full grid-cols-[2fr_3fr] divide-x">
      <div className="overflow-y-auto p-6">
        {page.title ? <h1 className="mb-4 text-lg font-semibold">{page.title}</h1> : null}
        {list ? (
          <TableWidget
            widget={list as never}
            bridge={bridge}
            onAction={onAction}
            onRowSelect={(row) => {
              setSelectedRow(row);
              setInputs((prev) => ({ ...prev, detail: row }));
            }}
            selectedId={selectedRow?.id as string | undefined}
          />
        ) : null}
      </div>
      <div className="overflow-y-auto p-6">
        {selectedRow ? (
          <DetailPane
            detail={detail}
            row={selectedRow}
            bridge={bridge}
            inputs={inputs}
            refreshDb={refreshDb}
            recordStepOutput={recordStepOutput}
          />
        ) : (
          <p className="text-sm text-muted-foreground">从左侧选择一行查看详情</p>
        )}
      </div>
    </div>
  );
}

interface DetailPaneProps {
  detail: Detail | undefined;
  row: Record<string, unknown>;
  bridge: LayoutProps['bridge'];
  inputs: Record<string, unknown>;
  refreshDb: () => Promise<void>;
  recordStepOutput: (stepId: string, output: unknown) => void;
}

function DetailPane({ detail, row, bridge, inputs, refreshDb, recordStepOutput }: DetailPaneProps): React.ReactElement {
  if (!detail) return <p className="text-sm text-muted-foreground">未配置 detail 视图</p>;
  if (detail.tabs && detail.tabs.length > 0) {
    return <DetailTabs tabs={detail.tabs} row={row} bridge={bridge} inputs={inputs} refreshDb={refreshDb} recordStepOutput={recordStepOutput} />;
  }
  if (detail.view) {
    return <DetailViewBody view={detail.view} row={row} bridge={bridge} inputs={inputs} refreshDb={refreshDb} recordStepOutput={recordStepOutput} />;
  }
  return <p className="text-sm text-muted-foreground">未配置 detail 视图</p>;
}

interface DetailTabsProps extends Omit<DetailPaneProps, 'detail'> {
  tabs: DetailTab[];
}

function DetailTabs({ tabs, row, bridge, inputs, refreshDb, recordStepOutput }: DetailTabsProps): React.ReactElement {
  const [active, setActive] = React.useState(0);
  const tab = tabs[active] ?? tabs[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            className={
              i === active
                ? 'border-b-2 border-primary px-3 py-2 text-sm font-medium'
                : 'px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
            }
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <DetailViewBody
        view={tab.view}
        row={row}
        bridge={bridge}
        inputs={inputs}
        refreshDb={refreshDb}
        recordStepOutput={recordStepOutput}
      />
    </div>
  );
}

interface DetailViewBodyProps extends Omit<DetailPaneProps, 'detail'> {
  view: DetailFormView | DetailTableView | DetailResultView;
}

function DetailViewBody({ view, row, bridge, inputs, refreshDb, recordStepOutput }: DetailViewBodyProps): React.ReactElement {
  if ('form' in view) {
    return <DetailForm view={view} row={row} bridge={bridge} inputs={inputs} refreshDb={refreshDb} recordStepOutput={recordStepOutput} />;
  }
  if ('type' in view && view.type === 'table') {
    return <DetailTable view={view} />;
  }
  if ('type' in view && view.type === 'result') {
    return (
      <DetailResult
        view={view}
        row={row}
        bridge={bridge}
        inputs={inputs}
        recordStepOutput={recordStepOutput}
        refreshDb={refreshDb}
      />
    );
  }
  return <p className="text-sm text-muted-foreground">未识别的 view 类型</p>;
}

function DetailTable({ view }: { view: DetailTableView }): React.ReactElement {
  const data = useResolvedProp(view.data) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(data) || data.length === 0) {
    return <p className="text-sm text-muted-foreground">没有数据</p>;
  }
  const columns = Object.keys(data[0]);
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((c) => (
              <th key={c} className="border-b px-3 py-2 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={(row.id as string) ?? i} className="border-b last:border-b-0">
              {columns.map((c) => (
                <td key={c} className="px-3 py-2">
                  {String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DetailFormProps extends Omit<DetailPaneProps, 'detail'> {
  view: DetailFormView;
}

function DetailForm({ view, row, bridge, refreshDb, recordStepOutput }: DetailFormProps): React.ReactElement {
  const [values, setValues] = React.useState<Record<string, unknown>>(row);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setValues(row), [row]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!view.submit) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await runEventDsl(
        view.submit.run,
        { inputs: values, rowId: row.id as string, patch: values, data: values },
        bridge,
        {
          onWorkflowResult: (id, output, status) => {
            if (status === 'success') recordStepOutput(id, output);
          },
          onDbMutation: () => {
            void refreshDb();
          },
        },
      );
      if (!r.ok) setError(r.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {view.form.map((field, i) => (
        <FormFieldRenderer
          key={(field.name as string) ?? i}
          field={field}
          value={values[field.name as string]}
          onChange={(v) => setValues((prev) => ({ ...prev, [field.name as string]: v }))}
        />
      ))}
      {view.submit ? (
        <Button type="submit" disabled={submitting}>
          {submitting ? '保存中…' : view.submit.label}
        </Button>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

interface DetailResultProps extends Omit<DetailPaneProps, 'detail'> {
  view: DetailResultView;
}

function DetailResult({ view, row, bridge, inputs, recordStepOutput }: DetailResultProps): React.ReactElement {
  const [result, setResult] = React.useState<unknown>(undefined);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      const r = await runEventDsl(
        view.run,
        { inputs: { ...inputs, ...(view.input ?? {}), detail: row, id: row.id } },
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
  }, [view.run, view.input, row, bridge, inputs, recordStepOutput]);

  if (loading) return <p className="text-sm text-muted-foreground">分析中…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  return <ResultRenderer render={view.render} value={result} />;
}
