'use client';

import * as React from 'react';
import { AlertCircle, Clock, Loader2, MessageSquare, Plus, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { AutoReplyEditor } from './AutoReplyEditor';
import { AutoReplyStatusBadge } from './AutoReplyStatusBadge';
import { formatAutoReplyTime } from './auto-reply-utils';
import { useAutoReplyRules, type AutoReplyRule, type AutoReplyRuleDraft } from './use-auto-reply-rules';
import { useAppSettings } from './use-goofish-app-data';

const RISK_NOTE = '白名单话术新增/修改后默认 pending；只有审核通过的 active 规则会被自动回复扫描使用。每买家 5 分钟最多 1 条，全账号 1 分钟最多 10 条频控。';
const CONFIRM_BREAKER = '一键熔断会把所有 active 规则降为 pending，需重新审核才能继续自动回复。确认？';
const CONFIRM_DELETE = '确认删除这条话术？删除后无法恢复。';
const NEW_RULE_DRAFT: AutoReplyRuleDraft = {
  trigger_pattern: '',
  trigger_type: 'keyword',
  reply_template: '',
  category: '其他',
  enabled: true,
  status: 'pending',
};

function confirmAction(message: string): boolean {
  return typeof window === 'undefined' || window.confirm(message);
}

export function AutoReplyTab(): React.ReactElement {
  const state = useAutoReplyTabState();
  const { rules, loading, error, selected, activeCount } = state;
  return (
    <div className="flex flex-col gap-5">
      <Header
        globalEnabled={state.globalEnabled}
        onToggle={state.setGlobalEnabled}
        onBreaker={state.handleBreaker}
        breakerBusy={state.breakerBusy}
        breakerDisabled={activeCount === 0}
        activeCount={activeCount}
      />
      <RiskBanner />
      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <RuleList
          rules={rules}
          loading={loading}
          selectedId={state.selectedId}
          onSelect={state.setSelectedId}
          onCreate={state.handleCreate}
        />
        <AutoReplyEditor
          rule={selected}
          onPatch={state.patchSelected}
          onApprove={state.approveSelected}
          onDelete={state.deleteSelected}
        />
      </div>
    </div>
  );
}

interface AutoReplyTabState {
  rules: AutoReplyRule[];
  loading: boolean;
  error: string | null;
  selected: AutoReplyRule | null;
  activeCount: number;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  globalEnabled: boolean;
  setGlobalEnabled: (v: boolean) => void;
  breakerBusy: boolean;
  handleCreate: () => Promise<void>;
  handleBreaker: () => Promise<void>;
  patchSelected: (patch: Partial<AutoReplyRule>) => void;
  approveSelected: () => void;
  deleteSelected: () => void;
}

function useAutoReplyTabState(): AutoReplyTabState {
  const { rules, loading, error, create, update, remove } = useAutoReplyRules();
  const settings = useAppSettings<{ auto_reply_global_enabled?: boolean }>();
  const [selectedId, setSelectedIdInternal] = React.useState<string | null>(null);
  const globalEnabled = settings.settings?.auto_reply_global_enabled !== false;
  const setGlobalEnabled = React.useCallback(
    (next: boolean) => settings.update({ auto_reply_global_enabled: next }),
    [settings],
  );
  const [breakerBusy, setBreakerBusy] = React.useState(false);
  const selected = React.useMemo(() => rules.find((r) => r.id === selectedId) ?? null, [rules, selectedId]);
  const activeCount = rules.filter((r) => r.status === 'active').length;

  // Debounced patch — accumulates rapid keystrokes into one PATCH ~500ms later.
  const pendingPatchRef = React.useRef<{ id: string; patch: Partial<AutoReplyRule> } | null>(null);
  const patchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPending = React.useCallback(() => {
    if (patchTimerRef.current) {
      clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    const pending = pendingPatchRef.current;
    pendingPatchRef.current = null;
    if (pending) void update(pending.id, pending.patch);
  }, [update]);

  // Flush pending patch before switching selection so the previous rule's
  // last keystroke isn't silently discarded.
  const setSelectedId = React.useCallback((id: string | null) => {
    flushPending();
    setSelectedIdInternal(id);
  }, [flushPending]);

  const handleCreate = React.useCallback(async () => {
    flushPending();
    const created = await create(NEW_RULE_DRAFT);
    if (created) setSelectedIdInternal(created.id);
  }, [create, flushPending]);

  const handleBreaker = React.useCallback(async () => {
    if (!confirmAction(CONFIRM_BREAKER)) return;
    setBreakerBusy(true);
    try {
      const targets = rules.filter((r) => r.status === 'active');
      await Promise.all(targets.map((r) => update(r.id, { status: 'pending' })));
    } finally {
      setBreakerBusy(false);
    }
  }, [rules, update]);

  const patchSelected = React.useCallback((patch: Partial<AutoReplyRule>) => {
    if (!selected) return;
    const prev = pendingPatchRef.current?.id === selected.id
      ? pendingPatchRef.current.patch
      : {};
    pendingPatchRef.current = { id: selected.id, patch: { ...prev, ...patch } };
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = setTimeout(() => {
      const pending = pendingPatchRef.current;
      pendingPatchRef.current = null;
      patchTimerRef.current = null;
      if (pending) void update(pending.id, pending.patch);
    }, 500);
  }, [selected, update]);

  // On unmount flush any pending patch so the user's last keystrokes hit DB.
  React.useEffect(() => () => {
    flushPending();
  }, [flushPending]);

  const approveSelected = React.useCallback(() => {
    flushPending();
    if (selected) void update(selected.id, { status: 'active' });
  }, [flushPending, selected, update]);

  const deleteSelected = React.useCallback(async () => {
    if (!selected || !confirmAction(CONFIRM_DELETE)) return;
    // Drop pending patch — the row is being deleted anyway.
    pendingPatchRef.current = null;
    if (patchTimerRef.current) {
      clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    const ok = await remove(selected.id);
    if (ok) setSelectedIdInternal(null);
  }, [remove, selected]);

  return {
    rules, loading, error, selected, activeCount,
    selectedId, setSelectedId,
    globalEnabled, setGlobalEnabled,
    breakerBusy,
    handleCreate, handleBreaker,
    patchSelected, approveSelected, deleteSelected,
  };
}

function Header({
  globalEnabled,
  onToggle,
  onBreaker,
  breakerBusy,
  breakerDisabled,
  activeCount,
}: {
  globalEnabled: boolean;
  onToggle: (v: boolean) => void;
  onBreaker: () => void;
  breakerBusy: boolean;
  breakerDisabled: boolean;
  activeCount: number;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">白名单分级自动回复</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          只有审核通过的话术会自动回复买家，其他默认草稿。
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-1.5">
          <Switch checked={globalEnabled} onCheckedChange={onToggle} />
          <Label className="text-xs font-medium">白名单自动回复总开关</Label>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={onBreaker}
          disabled={breakerBusy || breakerDisabled}
          title={breakerDisabled ? '当前没有 active 规则' : `将 ${activeCount} 条 active 规则降为 pending`}
        >
          {breakerBusy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldAlert className="size-3.5" />}
          一键熔断
        </Button>
      </div>
    </div>
  );
}

function RiskBanner(): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>{RISK_NOTE}</span>
    </div>
  );
}

function RuleList({
  rules,
  loading,
  selectedId,
  onSelect,
  onCreate,
}: {
  rules: AutoReplyRule[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" onClick={onCreate} className="w-fit">
        <Plus className="size-3.5" />
        新增话术
      </Button>
      {loading && rules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            加载中…
          </CardContent>
        </Card>
      ) : rules.length === 0 ? (
        <EmptyList />
      ) : (
        <div className="flex flex-col gap-1.5">
          {rules.map((r) => (
            <RuleListRow
              key={r.id}
              rule={r}
              active={r.id === selectedId}
              onClick={() => onSelect(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyList(): React.ReactElement {
  return (
    <Card className="border-dashed">
      <CardContent className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-6 text-center">
        <MessageSquare className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">尚未配置任何白名单话术</p>
        <p className="text-[11px] leading-5 text-muted-foreground">
          点击上方「新增话术」开始配置；草稿审核通过后才会自动回复买家。
        </p>
      </CardContent>
    </Card>
  );
}

function RuleListRow({
  rule,
  active,
  onClick,
}: {
  rule: AutoReplyRule;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-all hover:border-foreground/20',
        active && 'border-foreground/40 ring-1 ring-foreground/15',
        !rule.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{rule.trigger_pattern || '（未填写触发条件）'}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {rule.trigger_type === 'regex' ? '正则' : '关键词'}
            {rule.category ? ` · ${rule.category}` : ''}
          </p>
        </div>
        <AutoReplyStatusBadge status={rule.status} />
      </div>
      <p className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
        <Clock className="size-3" />
        命中 {rule.match_count} 次
        {rule.last_matched_at ? ` · 上次 ${formatAutoReplyTime(rule.last_matched_at)}` : ' · 尚未命中'}
      </p>
    </button>
  );
}
