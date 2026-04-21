'use client';

import { memo, useState } from 'react';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { streamdownCode } from '@/lib/streamdown-code';
import type {
  ArtifactItem,
  DiagnosticsInfo,
  MemoryItem,
} from './debug-output-extract';

const streamdownPlugins = { cjk, code: streamdownCode, math, mermaid };

export const OUTCOME_CFG: Record<string, { label: string; cls: string }> = {
  done: { label: '完成', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  failed: { label: '失败', cls: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  blocked: { label: '阻塞', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
};

// ── Collapsible wrapper ─────────────────────────────────────────────────────

interface CollapsibleProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  tone?: 'default' | 'danger';
  children: React.ReactNode;
}

export function Collapsible({ title, count, defaultOpen = false, tone = 'default', children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`rounded-lg border ${tone === 'danger' ? 'border-red-500/30 bg-red-500/5' : 'border-border/50 bg-card'} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted/40 transition-colors"
      >
        <span className={`text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className={tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-foreground'}>{title}</span>
        {typeof count === 'number' && (
          <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5">{count}</span>
        )}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </section>
  );
}

// ── Summary (markdown) ──────────────────────────────────────────────────────

export const SummarySection = memo(({ markdown }: { markdown: string }) => (
  <section className="rounded-lg border border-border/50 bg-card px-4 py-3">
    <Streamdown
      className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 leading-relaxed text-sm"
      plugins={streamdownPlugins}
    >
      {markdown}
    </Streamdown>
  </section>
));
SummarySection.displayName = 'SummarySection';

// ── Trace (完整对话:思考 + 工具调用 + 结果) ────────────────────────────────

interface TraceSectionProps {
  loading: boolean;
  content: string | null;
  hasTrace: boolean;
  error: string | null;
  /** 首次展开时触发懒加载。 */
  onFirstOpen: () => void;
}

export function TraceSection({ loading, content, hasTrace, error, onFirstOpen }: TraceSectionProps) {
  const [open, setOpen] = useState(false);
  const [triggered, setTriggered] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !triggered) {
      setTriggered(true);
      onFirstOpen();
    }
  };

  return (
    <section className="rounded-lg border border-border/50 bg-card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted/40 transition-colors"
      >
        <span className={`text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="text-foreground">完整对话</span>
        <span className="text-[10px] text-muted-foreground">思考 · 工具调用 · 结果</span>
        {loading && <span className="ml-auto text-[10px] text-muted-foreground">加载中…</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1">
          {loading && (
            <div className="text-[10px] text-muted-foreground py-2">正在从执行记录里抽取完整对话…</div>
          )}
          {!loading && error && (
            <div className="text-[11px] text-red-600 dark:text-red-400 py-1">
              加载失败:{error}
            </div>
          )}
          {!loading && !error && !hasTrace && (
            <div className="text-[10px] text-muted-foreground py-2 leading-relaxed">
              没有可查看的完整对话。可能原因:
              <br />
              · 该 step 本次未实际执行(命中 debug 缓存)
              <br />
              · 该 step 是老版本缓存,尚未包含 trace
            </div>
          )}
          {!loading && !error && content && (
            <Streamdown
              className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-[11px] leading-relaxed"
              plugins={streamdownPlugins}
            >
              {content}
            </Streamdown>
          )}
        </div>
      )}
    </section>
  );
}

// ── Artifacts ───────────────────────────────────────────────────────────────

function humanSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function ArtifactsSection({ items }: { items: ArtifactItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-border/50 bg-card">
      <div className="px-3 py-2 border-b border-border/30 text-xs font-medium">
        输出文件 <span className="text-muted-foreground">({items.length})</span>
      </div>
      <ul className="divide-y divide-border/30">
        {items.map((a, i) => (
          <li key={i} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
            <span className="shrink-0">📄</span>
            <span className="font-medium truncate" title={a.path}>{a.name}</span>
            {a.mimeType && (
              <span className="text-[9px] bg-muted rounded px-1 py-0 text-muted-foreground shrink-0">
                {a.mimeType}
              </span>
            )}
            {a.sizeBytes ? (
              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{humanSize(a.sizeBytes)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Business fields (KV) ────────────────────────────────────────────────────

function formatFieldValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function FieldsSection({ fields }: { fields: Array<[string, unknown]> }) {
  if (fields.length === 0) return null;
  return (
    <section className="rounded-lg border border-border/50 bg-card">
      <div className="px-3 py-2 border-b border-border/30 text-xs font-medium">业务输出</div>
      <dl className="divide-y divide-border/30">
        {fields.map(([k, v]) => {
          const value = formatFieldValue(v);
          const multiline = value.includes('\n') || value.length > 80;
          return (
            <div key={k} className={`px-3 py-1.5 ${multiline ? 'space-y-1' : 'flex items-start gap-2'}`}>
              <dt className="text-[10px] font-mono text-muted-foreground shrink-0 min-w-[100px]">{k}</dt>
              <dd className={`text-[11px] ${multiline ? 'font-mono bg-muted/30 rounded px-2 py-1 whitespace-pre-wrap break-all' : 'flex-1 truncate'}`} title={value}>
                {value}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

export function DiagnosticsSection({ d, hasError }: { d: DiagnosticsInfo; hasError: boolean }) {
  return (
    <Collapsible
      title={d.errorName ?? '诊断信息'}
      tone={hasError ? 'danger' : 'default'}
      defaultOpen={hasError}
    >
      <div className="space-y-2 text-[11px]">
        {d.sanitizedMessage && (
          <div>
            <div className="text-[10px] text-muted-foreground mb-0.5">消息</div>
            <div className="whitespace-pre-wrap break-words leading-relaxed">{d.sanitizedMessage}</div>
          </div>
        )}
        {d.executionCwd && (
          <div>
            <div className="text-[10px] text-muted-foreground mb-0.5">执行目录</div>
            <div className="font-mono text-[10px] break-all">{d.executionCwd}</div>
          </div>
        )}
        {(d.allowedRuntimeTools?.length || d.allowedClaudeTools?.length) && (
          <div>
            <div className="text-[10px] text-muted-foreground mb-1">允许的工具</div>
            <div className="flex flex-wrap gap-1">
              {d.allowedRuntimeTools?.map(t => (
                <span key={`r-${t}`} className="text-[9px] bg-sky-500/10 text-sky-700 dark:text-sky-400 rounded px-1.5 py-0">
                  {t}
                </span>
              ))}
              {d.allowedClaudeTools?.map(t => (
                <span key={`c-${t}`} className="text-[9px] bg-violet-500/10 text-violet-700 dark:text-violet-400 rounded px-1.5 py-0">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Collapsible>
  );
}

// ── Memory append ───────────────────────────────────────────────────────────

export function MemorySection({ items }: { items: MemoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <Collapsible title="写入记忆" count={items.length}>
      <ul className="space-y-2 text-[11px]">
        {items.map((m, i) => (
          <li key={i} className="rounded bg-muted/30 p-2">
            <div className="text-[10px] text-muted-foreground mb-1">scope: {m.scope}</div>
            <div className="whitespace-pre-wrap break-words leading-relaxed max-h-[200px] overflow-auto">
              {m.content}
            </div>
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}
