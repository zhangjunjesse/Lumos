'use client';

import * as React from 'react';
import { AlertCircle, Bell, CalendarClock, Loader2, Play, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { nativeActionUrl, useAppCollection } from './use-goofish-app-data';
import { RecentNotifications, useGoofishNotifications } from './reminder-recent-notifications';
import {
  type ReminderChannel,
  type ReminderRule,
  type ReminderRuleDraft,
  type ReminderRuleType,
  useReminderRules,
} from './use-reminder-rules';

const RULE_TYPE_OPTIONS: Array<{ value: ReminderRuleType; label: string; hint: string }> = [
  { value: 'new_message', label: '新买家消息', hint: '有未读消息时触发，按未读数排优先级' },
  { value: 'reply_timeout', label: '回复超时', hint: '买家最后一条消息超过阈值未回复时触发' },
  { value: 'keyword_hit', label: '关键词命中', hint: '买家消息匹配关键词时触发' },
  { value: 'draft_backlog', label: '草稿堆积', hint: '待发送/待确认草稿数超过阈值时触发' },
];

const CHANNEL_OPTIONS: Array<{
  value: ReminderChannel;
  label: string;
  hint?: string;
  disabled?: boolean;
}> = [
  { value: 'in_app', label: '应用内', hint: '写入通知中心，状态停在 ready' },
  { value: 'wechat', label: '微信', hint: '需要 IM 桥已绑定' },
  { value: 'desktop', label: '桌面', hint: '待 NotificationCenter 接入', disabled: true },
];

const REMINDER_AUTOMATION_ID = 'goofish-check-reminders';
const REMINDER_AUTOMATION_ACTION = 'goofish:check-reminders';
const DEFAULT_REMINDER_SCAN_SCHEDULE = '每 5 分钟';

type ScanFeedback = { kind: 'idle' | 'running' | 'ok' | 'error'; text: string };

interface ReminderScanResponse {
  ok?: boolean;
  message?: string;
  runId?: string;
  triggered?: unknown[];
  skipped?: number;
  errors?: Array<{ ruleId?: string; reason?: string }>;
}

interface AppAutomationRow {
  id: string;
  title?: string;
  enabled?: boolean;
  schedule?: string;
  description?: string;
  native_action?: string;
  last_status?: 'not_connected' | 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  last_run_summary?: string;
  last_run_id?: string;
  last_run_at?: string;
  schedule_id?: string;
  schedule_status?: 'not_connected' | 'scheduled' | 'paused' | 'failed';
  schedule_error?: string;
  next_run_at?: string | null;
  updated_at?: string;
}

export function RemindersTab(): React.ReactElement {
  const { rules, loading, error, refresh: refreshRules, create, update, remove } = useReminderRules();
  const { rows: notifications, loading: notificationsLoading, refresh: refreshNotifications } = useGoofishNotifications();
  const {
    rows: automations,
    loading: automationsLoading,
    error: automationError,
    refresh: refreshAutomations,
    update: updateAutomation,
    create: createAutomation,
  } = useAppCollection<AppAutomationRow>('app_automations', {
    sortKey: 'native_action',
    sortDir: 'asc',
  });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [scanFeedback, setScanFeedback] = React.useState<ScanFeedback | null>(null);
  const [automationBusy, setAutomationBusy] = React.useState(false);

  React.useEffect(() => {
    if (!selectedId && rules.length > 0) setSelectedId(rules[0].id);
    if (selectedId && !rules.some((r) => r.id === selectedId)) {
      setSelectedId(rules[0]?.id ?? null);
    }
  }, [rules, selectedId]);

  const selected = React.useMemo(
    () => rules.find((r) => r.id === selectedId) ?? null,
    [rules, selectedId],
  );
  const reminderAutomation = React.useMemo(
    () => automations.find((row) => normalizeAction(row.native_action) === REMINDER_AUTOMATION_ACTION) ?? null,
    [automations],
  );

  const handleCreate = async () => {
    setBusy(true);
    try {
      const draft: ReminderRuleDraft = {
        rule_type: 'new_message',
        threshold_minutes: 30,
        threshold_count: 5,
        keywords: [],
        channels: ['in_app'],
        enabled: true,
        cooldown_minutes: 10,
      };
      const next = await create(draft);
      if (next) setSelectedId(next.id);
    } finally {
      setBusy(false);
    }
  };

  const handleTriggerTest = React.useCallback(async () => {
    setScanFeedback({ kind: 'running', text: '正在扫描已启用的提醒规则…' });
    try {
      const res = await fetch(nativeActionUrl('goofish', 'check-reminders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      const json = (await res.json().catch(() => ({}))) as ReminderScanResponse;
      if (!res.ok || !json.ok) {
        const detail = json.errors?.map((item) => item.reason).filter(Boolean).join('；');
        throw new Error(detail || json.message || '提醒扫描失败');
      }
      setScanFeedback({ kind: 'ok', text: formatScanResponse(json) });
      await Promise.all([refreshRules(), refreshNotifications(), refreshAutomations()]);
    } catch (err) {
      setScanFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : '提醒扫描失败',
      });
    }
  }, [refreshAutomations, refreshNotifications, refreshRules]);

  const handleEnableReminderScan = React.useCallback(async () => {
    setAutomationBusy(true);
    setScanFeedback(null);
    try {
      let row = reminderAutomation;
      if (!row) {
        row = await createAutomation({
          id: REMINDER_AUTOMATION_ID,
          title: '提醒规则检查',
          enabled: true,
          schedule: DEFAULT_REMINDER_SCAN_SCHEDULE,
          native_action: REMINDER_AUTOMATION_ACTION,
          description: '按已启用的提醒规则检查：新消息 / 回复超时 / 关键词命中 / 草稿堆积，命中后写入应用通知中心和（可选）微信通道。',
          last_status: 'idle',
          schedule_status: 'not_connected',
          schedule_error: '',
          next_run_at: null,
          last_run_summary: '已创建默认提醒扫描；同步后每 5 分钟运行一次。',
        });
      } else {
        const patch: Partial<AppAutomationRow> = {};
        if (row.enabled !== true) patch.enabled = true;
        if (!row.schedule) patch.schedule = DEFAULT_REMINDER_SCAN_SCHEDULE;
        if (!row.native_action) patch.native_action = REMINDER_AUTOMATION_ACTION;
        if (Object.keys(patch).length > 0) {
          row = await updateAutomation(row.id, patch) ?? row;
        }
      }

      if (!row) throw new Error('创建提醒扫描自动化失败，请刷新后重试。');

      const res = await fetch(nativeActionUrl('app', 'sync-automation-schedule'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId: row.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) throw new Error(json.message ?? '同步定时任务失败');
      setScanFeedback({ kind: 'ok', text: json.message ?? '已开启提醒自动扫描。' });
      await refreshAutomations();
    } catch (err) {
      setScanFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : '开启提醒自动扫描失败',
      });
    } finally {
      setAutomationBusy(false);
    }
  }, [createAutomation, refreshAutomations, reminderAutomation, updateAutomation]);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <RuleList
        rules={rules}
        loading={loading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={handleCreate}
        creating={busy}
      />
      <div className="flex flex-col gap-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <ReminderScanStatus
          automation={reminderAutomation}
          loading={automationsLoading}
          error={automationError}
          busy={automationBusy}
          onEnableAndSync={handleEnableReminderScan}
        />
        {selected ? (
          <RuleEditor
            rule={selected}
            onUpdate={(patch) => void update(selected.id, patch)}
            onDelete={async () => {
              if (typeof window !== 'undefined' && !window.confirm('删除该提醒规则？')) return;
              await remove(selected.id);
            }}
            onTriggerTest={handleTriggerTest}
            triggering={scanFeedback?.kind === 'running'}
            scanFeedback={scanFeedback}
          />
        ) : (
          <EmptyEditor onCreate={handleCreate} />
        )}
        <RecentNotifications
          rows={notifications}
          loading={notificationsLoading}
          onRefresh={refreshNotifications}
        />
      </div>
    </div>
  );
}

function RuleList({
  rules,
  loading,
  selectedId,
  onSelect,
  onCreate,
  creating,
}: {
  rules: ReminderRule[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  creating: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">提醒规则</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {rules.length} 条 · 含已停用
          </p>
        </div>
        <Button size="sm" onClick={onCreate} disabled={creating}>
          {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          新增
        </Button>
      </div>
      {loading && rules.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          加载中…
        </div>
      ) : null}
      {!loading && rules.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
          还没有规则，点击「新增」创建
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        {rules.map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            active={rule.id === selectedId}
            onClick={() => onSelect(rule.id)}
          />
        ))}
      </div>
    </div>
  );
}

function RuleCard({
  rule,
  active,
  onClick,
}: {
  rule: ReminderRule;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
        active ? 'border-foreground/40 ring-1 ring-foreground/10' : 'hover:border-foreground/20',
        !rule.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Bell className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
          {ruleTypeLabel(rule.rule_type)}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px]',
            rule.enabled
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {rule.enabled ? '启用' : '停用'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {rule.channels.map((c) => (
          <span
            key={c}
            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {channelLabel(c)}
          </span>
        ))}
        {rule.channels.length === 0 ? (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
            未选通道
          </span>
        ) : null}
      </div>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {rule.last_triggered_at ? `上次触发 ${formatTime(rule.last_triggered_at)}` : '尚未触发'}
      </p>
    </button>
  );
}

function RuleEditor({
  rule,
  onUpdate,
  onDelete,
  onTriggerTest,
  triggering,
  scanFeedback,
}: {
  rule: ReminderRule;
  onUpdate: (patch: Partial<ReminderRuleDraft>) => void;
  onDelete: () => Promise<void> | void;
  onTriggerTest: () => Promise<void> | void;
  triggering: boolean;
  scanFeedback: ScanFeedback | null;
}) {
  const [keywordsText, setKeywordsText] = React.useState(rule.keywords.join(','));
  React.useEffect(() => {
    setKeywordsText(rule.keywords.join(','));
  }, [rule.id, rule.keywords]);

  const ruleTypeMeta = RULE_TYPE_OPTIONS.find((opt) => opt.value === rule.rule_type) ?? RULE_TYPE_OPTIONS[0];

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{ruleTypeLabel(rule.rule_type)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{ruleTypeMeta.hint}</p>
          </div>
          <Switch
            checked={rule.enabled}
            onCheckedChange={(enabled) => onUpdate({ enabled })}
          />
        </div>

        <Field label="触发类型">
          <Select value={rule.rule_type} onValueChange={(value) => onUpdate({ rule_type: value as ReminderRuleType })}>
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {rule.rule_type === 'reply_timeout' ? (
          <Field label="超时阈值" hint="买家最后消息距今超过这个时长时触发">
            <NumberInput
              value={rule.threshold_minutes}
              onChange={(v) => onUpdate({ threshold_minutes: v })}
              min={1}
              max={1440}
              suffix="分钟"
            />
          </Field>
        ) : null}

        {rule.rule_type === 'draft_backlog' ? (
          <Field label="数量阈值" hint="待发送 / 待确认的草稿数累计到这个值时触发">
            <NumberInput
              value={rule.threshold_count}
              onChange={(v) => onUpdate({ threshold_count: v })}
              min={1}
              max={200}
              suffix="条"
            />
          </Field>
        ) : null}

        {rule.rule_type === 'keyword_hit' ? (
          <Field label="关键词" hint="用逗号分隔，命中任意一个即触发" align="top">
            <Textarea
              value={keywordsText}
              onChange={(e) => {
                setKeywordsText(e.target.value);
                const list = e.target.value
                  .split(/[,，\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                onUpdate({ keywords: list });
              }}
              rows={2}
              placeholder="退款,投诉,差评"
              className="resize-none"
            />
          </Field>
        ) : null}

        <Field label="提醒通道" hint="可同时勾选多个通道" align="top">
          <ChannelCheckboxGroup
            channels={rule.channels}
            onChange={(next) => onUpdate({ channels: next })}
          />
        </Field>

        <Field label="冷却时间" hint="同一规则两次触发的最小间隔">
          <NumberInput
            value={rule.cooldown_minutes}
            onChange={(v) => onUpdate({ cooldown_minutes: v })}
            min={1}
            max={1440}
            suffix="分钟"
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onTriggerTest()}
              disabled={triggering}
              title="立即运行提醒扫描，命中规则后会写入下面的触发记录"
            >
              {triggering ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              立即扫描测试
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onDelete()}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
        {scanFeedback && scanFeedback.kind !== 'idle' ? (
          <div
            className={cn(
              'rounded-lg border px-3 py-2 text-xs leading-5',
              scanFeedback.kind === 'error'
                ? 'border-destructive/30 bg-destructive/5 text-destructive'
                : scanFeedback.kind === 'running'
                  ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                  : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
            )}
          >
            {scanFeedback.text}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReminderScanStatus({
  automation,
  loading,
  error,
  busy,
  onEnableAndSync,
}: {
  automation: AppAutomationRow | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onEnableAndSync: () => Promise<void> | void;
}) {
  const status = describeReminderAutomation(automation, loading);
  const needsSetup = !automation
    || automation.enabled !== true
    || automation.schedule_status !== 'scheduled';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3 text-xs',
        status.tone === 'ok'
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : status.tone === 'warn'
            ? 'border-amber-500/30 bg-amber-500/5'
            : 'border-border bg-card',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {loading ? (
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <p className="font-medium text-foreground">自动扫描提醒</p>
          <p className="mt-0.5 text-muted-foreground">{status.text}</p>
          {error ? <p className="mt-1 text-destructive">自动化状态加载失败：{error}</p> : null}
          {automation?.schedule_error ? (
            <p className="mt-1 text-destructive">调度失败：{automation.schedule_error}</p>
          ) : null}
        </div>
      </div>
      {needsSetup ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onEnableAndSync()}
          disabled={busy || loading}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          开启并同步
        </Button>
      ) : null}
    </div>
  );
}

function ChannelCheckboxGroup({
  channels,
  onChange,
}: {
  channels: ReminderChannel[];
  onChange: (next: ReminderChannel[]) => void;
}) {
  const toggle = (value: ReminderChannel, checked: boolean) => {
    const set = new Set(channels);
    if (checked) set.add(value);
    else set.delete(value);
    onChange(Array.from(set));
  };
  return (
    <div className="flex flex-col gap-2">
      {CHANNEL_OPTIONS.map((opt) => {
        const checked = channels.includes(opt.value);
        return (
          <label
            key={opt.value}
            className={cn(
              'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
              opt.disabled && 'cursor-not-allowed bg-muted/30',
              !opt.disabled && 'cursor-pointer hover:bg-muted/30',
            )}
          >
            <Checkbox
              className="mt-0.5"
              checked={checked}
              disabled={opt.disabled}
              onCheckedChange={(state) => toggle(opt.value, state === true)}
            />
            <div className="min-w-0">
              <p className={cn('font-medium', opt.disabled && 'text-muted-foreground')}>
                {opt.label}
              </p>
              {opt.hint ? (
                <p className="text-[11px] text-muted-foreground">{opt.hint}</p>
              ) : null}
            </div>
          </label>
        );
      })}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Math.max(min, Math.min(max, Number(e.target.value) || min));
          onChange(v);
        }}
        className="w-28 tabular-nums"
      />
      {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

function EmptyEditor({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <Bell className="size-6 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-sm font-medium">还没有提醒规则</p>
        <p className="max-w-md text-xs leading-5 text-muted-foreground">
          创建后会写入本机数据库；只有勾选了通道的规则才会被扫描引擎处理。
        </p>
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-3.5" />
          新增提醒
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  align,
  children,
}: {
  label: string;
  hint?: string;
  align?: 'top';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid gap-2 sm:grid-cols-[160px_1fr]',
        align === 'top' ? 'sm:items-start' : 'sm:items-center',
      )}
    >
      <Label className="flex flex-col gap-0.5 text-xs font-medium leading-tight">
        {label}
        {hint ? <span className="text-[11px] font-normal text-muted-foreground">{hint}</span> : null}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function normalizeAction(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function formatScanResponse(json: ReminderScanResponse): string {
  const triggered = Array.isArray(json.triggered) ? json.triggered.length : 0;
  const skipped = typeof json.skipped === 'number' ? json.skipped : 0;
  const errors = Array.isArray(json.errors) ? json.errors.length : 0;
  if (triggered === 0 && skipped === 0 && errors === 0) {
    return '扫描完成：当前没有命中提醒条件。';
  }
  return `扫描完成：${json.message ?? `触发 ${triggered}，跳过 ${skipped}${errors ? `，错误 ${errors}` : ''}。`}`;
}

function describeReminderAutomation(
  automation: AppAutomationRow | null,
  loading: boolean,
): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (loading) {
    return { text: '正在读取提醒扫描配置…', tone: 'muted' };
  }
  if (!automation) {
    return {
      text: `当前没有提醒扫描自动化，系统不会定时扫描；默认间隔是 ${DEFAULT_REMINDER_SCAN_SCHEDULE}。`,
      tone: 'warn',
    };
  }

  const schedule = automation.schedule || DEFAULT_REMINDER_SCAN_SCHEDULE;
  if (automation.enabled !== true) {
    return {
      text: `当前未开启自动扫描；开启并同步后按 ${schedule} 扫描一次。`,
      tone: 'warn',
    };
  }
  if (automation.schedule_status !== 'scheduled') {
    return {
      text: `已开启，但还没同步到 Lumos 调度器；同步后按 ${schedule} 扫描一次。`,
      tone: 'warn',
    };
  }
  const next = automation.next_run_at ? `，下次 ${formatTime(automation.next_run_at)}` : '';
  return {
    text: `已开启，按 ${schedule} 扫描一次${next}。`,
    tone: 'ok',
  };
}

function ruleTypeLabel(type: ReminderRuleType): string {
  return RULE_TYPE_OPTIONS.find((opt) => opt.value === type)?.label ?? type;
}

function channelLabel(channel: ReminderChannel): string {
  return CHANNEL_OPTIONS.find((opt) => opt.value === channel)?.label ?? channel;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
