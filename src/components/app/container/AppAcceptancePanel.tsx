'use client';

import * as React from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ListChecks,
  RotateCcw,
  Save,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import type { NativeAppAcceptanceItem } from '@/lib/app/native-spec';

import type { RendererBridge } from '../declarative/bridge';

interface AppAcceptancePanelProps {
  acceptance: NativeAppAcceptanceItem[];
  bridge: RendererBridge;
}

interface AcceptanceCheckRow {
  id: string;
  acceptance_id?: unknown;
  done?: unknown;
  status?: unknown;
  evidence?: unknown;
  failure_reason?: unknown;
  evidence_run_id?: unknown;
  completed_at?: unknown;
  updated_at?: unknown;
}

type AcceptanceStatus = 'unverified' | 'passed' | 'failed' | 'blocked';

interface RunHistoryRow {
  id: string;
  title?: unknown;
  status?: unknown;
  summary?: unknown;
  failure_reason?: unknown;
  updated_at?: unknown;
}

export function AppAcceptancePanel({
  acceptance,
  bridge,
}: AppAcceptancePanelProps): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const [checks, setChecks] = React.useState<Record<string, AcceptanceCheckRow>>({});
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [latestSelfCheck, setLatestSelfCheck] = React.useState<RunHistoryRow | null>(null);
  const [savingId, setSavingId] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    async function loadChecks() {
      try {
        const rows = await bridge.dbQuery('acceptance_checks', { limit: 200 });
        const history = await bridge.dbQuery('run_history', { limit: 50 });
        if (cancelled) return;
        const indexed = indexChecks(rows as AcceptanceCheckRow[]);
        setChecks(indexed);
        setNotes(indexNotes(indexed));
        setLatestSelfCheck(findLatestInstallSelfCheck(history as RunHistoryRow[]));
        setError('');
      } catch (loadError) {
        if (!cancelled) setError((loadError as Error).message);
      }
    }
    if (acceptance.length > 0) void loadChecks();
    return () => {
      cancelled = true;
    };
  }, [acceptance.length, bridge]);

  const saveStatus = React.useCallback(async (
    item: NativeAppAcceptanceItem,
    status: AcceptanceStatus,
  ) => {
    const existing = checks[item.id];
    const note = (notes[item.id] ?? '').trim();
    const now = new Date().toISOString();
    setSavingId(item.id);
    setError('');
    const patch = buildAcceptancePatch({
      item,
      status,
      note,
      latestSelfCheck,
      now,
    });
    try {
      const row = existing
        ? await bridge.dbUpdate('acceptance_checks', existing.id, patch)
        : await bridge.dbCreate('acceptance_checks', { id: item.id, ...patch });
      const nextRow: AcceptanceCheckRow = {
        ...(row ?? existing ?? { id: item.id }),
        id: row?.id ?? existing?.id ?? item.id,
        ...patch,
      };
      setChecks((current) => ({
        ...current,
        [item.id]: nextRow,
      }));
      setNotes((current) => ({
        ...current,
        [item.id]: rowNote(nextRow),
      }));
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSavingId('');
    }
  }, [bridge, checks, latestSelfCheck, notes]);

  const saveEvidence = React.useCallback(async (item: NativeAppAcceptanceItem) => {
    const existing = checks[item.id];
    const currentStatus = checkStatus(existing);
    const note = (notes[item.id] ?? '').trim();
    const now = new Date().toISOString();
    setSavingId(item.id);
    setError('');
    const patch = {
      acceptance_id: item.id,
      done: currentStatus === 'passed',
      status: currentStatus,
      evidence: note || null,
      failure_reason: currentStatus === 'failed' || currentStatus === 'blocked' ? note || null : null,
      evidence_run_id: latestSelfCheck?.id ?? null,
      updated_at: now,
    };
    try {
      const row = existing
        ? await bridge.dbUpdate('acceptance_checks', existing.id, patch)
        : await bridge.dbCreate('acceptance_checks', { id: item.id, ...patch });
      const nextRow: AcceptanceCheckRow = {
        ...(row ?? existing ?? { id: item.id }),
        id: row?.id ?? existing?.id ?? item.id,
        ...patch,
      };
      setChecks((current) => ({
        ...current,
        [item.id]: nextRow,
      }));
      setNotes((current) => ({ ...current, [item.id]: rowNote(nextRow) }));
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSavingId('');
    }
  }, [bridge, checks, latestSelfCheck, notes]);

  if (acceptance.length === 0) return null;

  const passedCount = acceptance.filter((item) => checkStatus(checks[item.id]) === 'passed').length;
  const blockedCount = acceptance.filter((item) => {
    const status = checkStatus(checks[item.id]);
    return status === 'failed' || status === 'blocked';
  }).length;
  const complete = passedCount === acceptance.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b bg-muted/10">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-xs hover:bg-muted/20"
        >
          <ListChecks className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">验收清单</span>
            <span className="ml-2 text-muted-foreground">
              已通过 {passedCount}/{acceptance.length}
            </span>
          </div>
          {blockedCount > 0 ? (
            <Badge variant="destructive">异常 {blockedCount}</Badge>
          ) : null}
          <Badge variant={complete ? 'secondary' : 'outline'}>
            {complete ? '已全部验收' : '待验收'}
          </Badge>
          <ChevronDown
            className={[
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open ? 'rotate-180' : '',
            ].join(' ')}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-3 px-4 pb-4 pt-1">
          <div className="text-xs leading-5 text-muted-foreground">
            验收记录会保存状态和证据。未接入、失败或无法验证的项应标为失败或阻塞，并保留运行记录或错误原因。
          </div>
          {latestSelfCheck ? (
            <div className="rounded-md border bg-background px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant={latestSelfCheck.status === 'success' ? 'secondary' : 'destructive'}>
                  最近安装自检
                </Badge>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {stringValue(latestSelfCheck.summary) || latestSelfCheck.id}
                </span>
              </div>
              {stringValue(latestSelfCheck.failure_reason) ? (
                <div className="mt-2 line-clamp-2 text-destructive">
                  {stringValue(latestSelfCheck.failure_reason)}
                </div>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              验收记录保存失败：{error}
            </div>
          ) : null}
          <div className="grid gap-2 md:grid-cols-2">
            {acceptance.map((item) => {
              const row = checks[item.id];
              const status = checkStatus(row);
              const disabled = savingId === item.id;
              const note = notes[item.id] ?? '';
              return (
                <div key={item.id} className="rounded-md border bg-background p-3">
                  <div className="grid gap-3">
                    <div className="flex items-start gap-3">
                      <StatusIcon status={status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1 text-sm font-medium leading-5">
                            {item.label}
                          </div>
                          <Badge variant={statusBadgeVariant(status)}>
                            {statusLabel(status)}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {item.howToVerify}
                        </div>
                        {stringValue(row?.evidence_run_id) ? (
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                            证据记录：{stringValue(row?.evidence_run_id)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Textarea
                        value={note}
                        disabled={disabled}
                        onChange={(event) => {
                          const value = event.target.value;
                          setNotes((current) => ({ ...current, [item.id]: value }));
                        }}
                        placeholder="记录看到的结果、失败原因、截图路径或运行记录编号"
                        className="min-h-16 resize-none text-xs"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() => void saveStatus(item, 'passed')}
                        >
                          <CheckCircle2 className="size-3" />
                          通过
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => void saveStatus(item, 'failed')}
                        >
                          <XCircle className="size-3" />
                          失败
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => void saveStatus(item, 'blocked')}
                        >
                          <Ban className="size-3" />
                          阻塞
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => void saveEvidence(item)}
                        >
                          <Save className="size-3" />
                          保存证据
                        </Button>
                        {status !== 'unverified' ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => void saveStatus(item, 'unverified')}
                          >
                            <RotateCcw className="size-3" />
                            重置
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function buildAcceptancePatch(input: {
  item: NativeAppAcceptanceItem;
  status: AcceptanceStatus;
  note: string;
  latestSelfCheck: RunHistoryRow | null;
  now: string;
}): Record<string, unknown> {
  if (input.status === 'unverified') {
    return {
      acceptance_id: input.item.id,
      done: false,
      status: 'unverified',
      evidence: null,
      failure_reason: null,
      evidence_run_id: null,
      completed_at: null,
      updated_at: input.now,
    };
  }
  const defaultEvidence = input.status === 'passed'
    ? `用户手动验收通过：${input.item.howToVerify}`
    : input.status === 'failed'
      ? '用户手动标记失败，需查看状态、运行结果或错误提示。'
      : '用户手动标记阻塞，当前能力尚无法完成 UI 验收。';
  const evidence = input.note || defaultEvidence;
  return {
    acceptance_id: input.item.id,
    done: input.status === 'passed',
    status: input.status,
    evidence,
    failure_reason: input.status === 'failed' || input.status === 'blocked' ? evidence : null,
    evidence_run_id: input.latestSelfCheck?.id ?? null,
    completed_at: input.status === 'passed' ? input.now : null,
    updated_at: input.now,
  };
}

function indexChecks(rows: AcceptanceCheckRow[]): Record<string, AcceptanceCheckRow> {
  const out: Record<string, AcceptanceCheckRow> = {};
  for (const row of rows) {
    if (typeof row.acceptance_id === 'string') {
      out[row.acceptance_id] = row;
    }
  }
  return out;
}

function indexNotes(rows: Record<string, AcceptanceCheckRow>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, row] of Object.entries(rows)) {
    out[id] = rowNote(row);
  }
  return out;
}

function rowNote(row: AcceptanceCheckRow | undefined): string {
  return stringValue(row?.evidence) || stringValue(row?.failure_reason);
}

function checkStatus(row: AcceptanceCheckRow | undefined): AcceptanceStatus {
  if (!row) return 'unverified';
  if (row.status === 'passed' || row.status === 'failed' || row.status === 'blocked') {
    return row.status;
  }
  return row.done === true ? 'passed' : 'unverified';
}

function statusLabel(status: AcceptanceStatus): string {
  switch (status) {
    case 'passed':
      return '已通过';
    case 'failed':
      return '失败';
    case 'blocked':
      return '阻塞';
    case 'unverified':
      return '未验证';
  }
}

function statusBadgeVariant(
  status: AcceptanceStatus,
): React.ComponentProps<typeof Badge>['variant'] {
  switch (status) {
    case 'passed':
      return 'secondary';
    case 'failed':
      return 'destructive';
    case 'blocked':
    case 'unverified':
      return 'outline';
  }
}

function StatusIcon({ status }: { status: AcceptanceStatus }): React.ReactElement {
  switch (status) {
    case 'passed':
      return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />;
    case 'failed':
      return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />;
    case 'blocked':
      return <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />;
    case 'unverified':
      return <ListChecks className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
  }
}

function findLatestInstallSelfCheck(rows: RunHistoryRow[]): RunHistoryRow | null {
  return rows.find((row) =>
    stringValue(row.title) === '安装自检' || row.id.startsWith('native-install-self-check-'),
  ) ?? null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
