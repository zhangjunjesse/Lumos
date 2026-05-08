'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { useResolvedProp } from '../../binding-context';
import type { RendererBridge } from '../../bridge';

interface Column {
  field: string;
  label: string;
  render?: 'text' | 'tag' | 'badge' | 'date' | 'markdown' | 'link';
  sortable?: boolean;
  search?: boolean;
}

interface FilterCfg {
  field: string;
  options?: string[];
}

interface ActionCfg {
  label: string;
  primary?: boolean;
  run?: string;
  open?: string;
  input?: Record<string, unknown>;
  confirm?: boolean | string;
}

interface TableWidgetSpec {
  type: 'table';
  data: string;
  columns: Column[];
  search?: { fields: string[] };
  filter?: FilterCfg[];
  actions?: { row?: ActionCfg[]; toolbar?: ActionCfg[] };
}

export interface TableWidgetProps {
  widget: TableWidgetSpec;
  bridge: RendererBridge;
  onAction: (
    event: 'run' | 'open',
    dsl: string,
    payload?: { rowId?: string; data?: Record<string, unknown> },
  ) => Promise<void>;
  onRowSelect?: (row: Record<string, unknown>) => void;
  selectedId?: string;
}

export function TableWidget({
  widget,
  bridge,
  onAction,
  onRowSelect,
  selectedId,
}: TableWidgetProps): React.ReactElement {
  const dataRaw = useResolvedProp(widget.data);
  const allRows = React.useMemo(
    () => (Array.isArray(dataRaw) ? (dataRaw as Array<Record<string, unknown>>) : []),
    [dataRaw],
  );

  const [searchText, setSearchText] = React.useState('');
  const [filterValues, setFilterValues] = React.useState<Record<string, string>>({});
  const [sort, setSort] = React.useState<{ field: string; dir: 'asc' | 'desc' } | null>(null);

  const searchableFields = React.useMemo(() => {
    if (widget.search?.fields?.length) return widget.search.fields;
    return widget.columns.filter((c) => c.search).map((c) => c.field);
  }, [widget.search, widget.columns]);

  const visibleRows = React.useMemo(() => {
    let rows = allRows.slice();
    if (searchText.trim() && searchableFields.length > 0) {
      const q = searchText.toLowerCase();
      rows = rows.filter((r) =>
        searchableFields.some((f) => String(r[f] ?? '').toLowerCase().includes(q)),
      );
    }
    for (const [field, value] of Object.entries(filterValues)) {
      if (value === '' || value === undefined) continue;
      rows = rows.filter((r) => String(r[field]) === value);
    }
    if (sort) {
      const { field, dir } = sort;
      rows.sort((a, b) => {
        const av = a[field] as unknown;
        const bv = b[field] as unknown;
        if (av === bv) return 0;
        if (av === undefined || av === null) return 1;
        if (bv === undefined || bv === null) return -1;
        return (av < bv ? -1 : 1) * (dir === 'asc' ? 1 : -1);
      });
    }
    return rows;
  }, [allRows, searchText, filterValues, sort, searchableFields]);

  const showSearch = searchableFields.length > 0;
  const showFilters = (widget.filter ?? []).length > 0;
  const showToolbar = (widget.actions?.toolbar ?? []).length > 0;

  const requestConfirm = async (msg: string | undefined) => {
    if (!msg) return true;
    return bridge.confirm(typeof msg === 'string' ? msg : '确定执行该操作？');
  };

  return (
    <div className="flex flex-col gap-3">
      {(showSearch || showFilters || showToolbar) ? (
        <div className="flex flex-wrap items-center gap-2">
          {showSearch ? (
            <Input
              placeholder="搜索…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="max-w-xs"
            />
          ) : null}
          {(widget.filter ?? []).map((f) => (
            <select
              key={f.field}
              value={filterValues[f.field] ?? ''}
              onChange={(e) =>
                setFilterValues((prev) => ({ ...prev, [f.field]: e.target.value }))
              }
              className="h-9 rounded border bg-background px-2 text-sm"
            >
              <option value="">{f.field}</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}
          <div className="ml-auto flex gap-2">
            {(widget.actions?.toolbar ?? []).map((a, i) => (
              <Button
                key={i}
                variant={a.primary ? 'default' : 'outline'}
                size="sm"
                onClick={async () => {
                  const dsl = a.run ?? a.open;
                  if (!dsl) return;
                  if (a.confirm) {
                    const ok = await requestConfirm(typeof a.confirm === 'string' ? a.confirm : undefined);
                    if (!ok) return;
                  }
                  await onAction(a.run ? 'run' : 'open', dsl, a.input ? { data: a.input } : undefined);
                }}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {widget.columns.map((c) => (
                <th
                  key={c.field}
                  className={`border-b px-3 py-2 text-left font-medium ${c.sortable ? 'cursor-pointer select-none' : ''}`}
                  onClick={() => {
                    if (!c.sortable) return;
                    setSort((prev) => {
                      if (prev?.field !== c.field) return { field: c.field, dir: 'asc' };
                      if (prev.dir === 'asc') return { field: c.field, dir: 'desc' };
                      return null;
                    });
                  }}
                >
                  {c.label}
                  {c.sortable && sort?.field === c.field
                    ? sort.dir === 'asc'
                      ? ' ↑'
                      : ' ↓'
                    : null}
                </th>
              ))}
              {(widget.actions?.row ?? []).length > 0 ? (
                <th className="border-b px-3 py-2 text-right font-medium">操作</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={widget.columns.length + ((widget.actions?.row ?? []).length > 0 ? 1 : 0)}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  没有数据
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const id = row.id as string | undefined;
                const isSelected = id !== undefined && id === selectedId;
                return (
                  <tr
                    key={id ?? JSON.stringify(row)}
                    className={`border-b last:border-b-0 ${isSelected ? 'bg-accent' : 'hover:bg-muted/30'} ${onRowSelect ? 'cursor-pointer' : ''}`}
                    onClick={() => onRowSelect?.(row)}
                  >
                    {widget.columns.map((c) => (
                      <td key={c.field} className="px-3 py-2">
                        <CellRenderer value={row[c.field]} render={c.render} />
                      </td>
                    ))}
                    {(widget.actions?.row ?? []).length > 0 ? (
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          {(widget.actions?.row ?? []).map((a, i) => (
                            <Button
                              key={i}
                              variant={a.primary ? 'default' : 'outline'}
                              size="xs"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const dsl = a.run ?? a.open;
                                if (!dsl) return;
                                if (a.confirm) {
                                  const ok = await requestConfirm(
                                    typeof a.confirm === 'string' ? a.confirm : `确认执行：${a.label}？`,
                                  );
                                  if (!ok) return;
                                }
                                await onAction(a.run ? 'run' : 'open', dsl, {
                                  rowId: id,
                                  data: { ...row, ...(a.input ?? {}) },
                                });
                              }}
                            >
                              {a.label}
                            </Button>
                          ))}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellRenderer({ value, render }: { value: unknown; render?: Column['render'] }): React.ReactElement {
  if (value === undefined || value === null) return <span className="text-muted-foreground">—</span>;
  switch (render) {
    case 'tag':
      return (
        <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
          {String(value)}
        </span>
      );
    case 'badge':
      return <Badge variant="secondary">{String(value)}</Badge>;
    case 'date': {
      const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
      return <span>{Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()}</span>;
    }
    case 'markdown':
      return <span>{String(value)}</span>;
    case 'link':
      return (
        <a className="text-primary hover:underline" href={String(value)} target="_blank" rel="noreferrer">
          {String(value)}
        </a>
      );
    case 'text':
    default:
      return <span>{String(value)}</span>;
  }
}
