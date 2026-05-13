'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Send, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { nativeActionUrl, useAppCollection } from './use-goofish-app-data';

type DraftStatus = 'draft' | 'pending_confirmation' | 'sent' | 'failed' | 'rejected';
type FilterKey = 'all' | 'pending_confirmation' | 'sent' | 'failed' | 'rejected';

interface ReplyDraftRow {
  id: string;
  conversation_id?: string;
  buyer_name?: string;
  item_title?: string;
  incoming_message?: string;
  draft_text?: string;
  status?: DraftStatus;
  confirmation_channel?: string;
  failure_reason?: string;
  risk_note?: string;
  matched_rule_id?: string;
  updated_at?: string;
  sent_at?: string;
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending_confirmation', label: '待确认' },
  { key: 'sent', label: '已发送' },
  { key: 'failed', label: '失败' },
  { key: 'rejected', label: '已拒绝' },
];

export function DraftsTab(): React.ReactElement {
  const { rows, loading, error, refresh } = useAppCollection<ReplyDraftRow>('reply_drafts', {
    sortKey: 'updated_at',
    sortDir: 'desc',
  });
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  React.useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((cur) => {
      if (cur && filtered.some((r) => r.id === cur)) return cur;
      return filtered[0].id;
    });
  }, [filtered]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">回复草稿</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            AI 与白名单话术生成的回复草稿统一在这里复核；发送前必须由用户在应用内或微信里确认。
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              type="button"
              variant={filter === f.key ? 'default' : 'outline'}
              size="xs"
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key !== 'all' ? (
                <span className="ml-1 tabular-nums opacity-70">
                  {rows.filter((r) => r.status === f.key).length}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            加载草稿中…
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
            {filter === 'all' ? '还没有任何草稿。前往「收件箱」选中一个会话点击「生成草稿」。' : '当前筛选下没有草稿'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <DraftList rows={filtered} selectedId={selectedId} onSelect={setSelectedId} />
          {selected ? (
            <DraftDetail draft={selected} onAfter={() => void refresh()} />
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed bg-muted/10 text-xs text-muted-foreground">
              选择一条草稿查看详情
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DraftList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ReplyDraftRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-xl border border-border/60 bg-card p-2">
      {rows.map((draft) => {
        const active = draft.id === selectedId;
        return (
          <li key={draft.id}>
            <button
              type="button"
              onClick={() => onSelect(draft.id)}
              className={cn(
                'flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                active ? 'border-foreground/30 bg-muted/40' : 'border-transparent hover:bg-muted/30',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {draft.buyer_name || '未知买家'}
                </span>
                <StatusBadge status={draft.status ?? 'draft'} />
              </div>
              {draft.item_title ? (
                <span className="truncate text-[11px] text-muted-foreground">
                  {draft.item_title}
                </span>
              ) : null}
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {snippet(draft.draft_text ?? '', 50)}
              </span>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                {draft.confirmation_channel ? (
                  <span className="rounded-full bg-muted px-2 py-0.5">
                    {draft.confirmation_channel}
                  </span>
                ) : <span />}
                <span>{formatTime(draft.updated_at)}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DraftDetail({
  draft,
  onAfter,
}: {
  draft: ReplyDraftRow;
  onAfter: () => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState<'send' | 'reject' | null>(null);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  React.useEffect(() => setFeedback(null), [draft.id]);

  const callAction = React.useCallback(
    async (action: 'send-draft' | 'reject-draft', kind: 'send' | 'reject') => {
      setBusy(kind);
      setFeedback(null);
      try {
        const res = await fetch(nativeActionUrl('goofish', action), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowId: draft.id, confirmed: true }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
        if (!res.ok || !json.ok) throw new Error(json.message ?? '操作失败');
        setFeedback({ kind: 'ok', text: json.message ?? '已完成' });
        onAfter();
      } catch (err) {
        setFeedback({ kind: 'error', text: err instanceof Error ? err.message : '操作失败' });
      } finally {
        setBusy(null);
      }
    },
    [draft.id, onAfter],
  );

  const status = draft.status ?? 'draft';
  const canSend = status === 'pending_confirmation' || status === 'draft' || status === 'failed';
  const canReject = status === 'pending_confirmation' || status === 'draft';

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">{draft.buyer_name || '未知买家'}</p>
            {draft.item_title ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{draft.item_title}</p>
            ) : null}
          </div>
          <StatusBadge status={status} />
        </div>

        <Field label="买家原文">
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 px-3 py-2 text-xs leading-5 [overflow-wrap:anywhere]">
            {draft.incoming_message || '（无）'}
          </pre>
        </Field>

        <Field label="草稿正文">
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-background px-3 py-2 text-xs leading-5 [overflow-wrap:anywhere]">
            {draft.draft_text || '（空）'}
          </pre>
        </Field>

        {draft.risk_note ? (
          <Field label="风险说明">
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
              {draft.risk_note}
            </p>
          </Field>
        ) : null}

        {status === 'sent' ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            已发送 · {formatTime(draft.sent_at ?? draft.updated_at)}
          </div>
        ) : null}

        {status === 'failed' && draft.failure_reason ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>发送失败：{draft.failure_reason}</AlertDescription>
          </Alert>
        ) : null}

        {feedback ? (
          <Alert variant={feedback.kind === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{feedback.text}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          {canReject ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void callAction('reject-draft', 'reject')}
              disabled={busy !== null}
            >
              {busy === 'reject' ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
              拒绝
            </Button>
          ) : null}
          {canSend ? (
            <Button
              size="sm"
              onClick={() => void callAction('send-draft', 'send')}
              disabled={busy !== null}
            >
              {busy === 'send' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              确认并发送
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: DraftStatus }) {
  const cfg = STATUS_BADGE[status] ?? STATUS_BADGE.draft;
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', cfg.cls)}>
      {cfg.label}
    </span>
  );
}

const STATUS_BADGE: Record<DraftStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-muted text-muted-foreground' },
  pending_confirmation: {
    label: '待确认',
    cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  sent: { label: '已发送', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  failed: { label: '失败', cls: 'bg-destructive/10 text-destructive' },
  rejected: { label: '已拒绝', cls: 'bg-muted text-muted-foreground line-through' },
};

function snippet(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
