'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface ResultRendererProps {
  render: 'markdown' | 'json' | 'table' | 'text';
  value: unknown;
}

export function ResultRenderer({ render, value }: ResultRendererProps): React.ReactElement {
  if (value === undefined || value === null) {
    return <p className="text-sm text-muted-foreground">无结果</p>;
  }
  switch (render) {
    case 'markdown':
      return (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </ReactMarkdown>
        </div>
      );
    case 'json':
      return (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    case 'table':
      if (!Array.isArray(value) || value.length === 0) {
        return <p className="text-sm text-muted-foreground">无表格数据</p>;
      }
      return <SimpleTable rows={value as Array<Record<string, unknown>>} />;
    case 'text':
    default:
      return <pre className="whitespace-pre-wrap text-sm">{String(value)}</pre>;
  }
}

function SimpleTable({ rows }: { rows: Array<Record<string, unknown>> }): React.ReactElement {
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {cols.map((c) => (
              <th key={c} className="border-b px-3 py-2 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={(row.id as string) ?? i} className="border-b last:border-b-0">
              {cols.map((c) => (
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
