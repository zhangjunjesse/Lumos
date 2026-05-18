'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type { Automation, AutomationKind } from './relations-types';
import {
  AutomationScheduleFields,
  type AutomationScheduleValue,
  Field,
} from './AutomationScheduleFields';
import {
  buildOncePatch,
  buildRecurringPatch,
  datetimeLocalValue,
  defaultOnceAt,
  isSupportedRecurringCron,
  parseRecurringScheduleConfig,
} from './automation-schedule-form';

export type AutomationDraft = Omit<Automation, 'id' | 'createdAt'>;

type ActionMode = 'reminder' | 'summary';

interface FormState extends AutomationScheduleValue {
  name: string;
  message: string;
  actionMode: ActionMode;
}

const KIND_OPTIONS: { value: AutomationKind; label: string; hint: string }[] = [
  { value: 'reminder_once', label: '一次性', hint: '指定某个时间点执行一次' },
  { value: 'reminder_recurring', label: '周期任务', hint: '每天 / 每周 / 每 N 小时重复' },
];

const ACTION_OPTIONS: { value: ActionMode; label: string; hint: string }[] = [
  { value: 'reminder', label: '纯提醒', hint: '到点把内容作为提醒发给你' },
  { value: 'summary', label: '微信消息总结', hint: '读取本机微信消息生成报告（耗时较长）' },
];

/** 跟进/回顾联动的 action 不在此弹框改写，保留原 action 仅换文案。 */
function isLinkedAction(automation: Automation | null): boolean {
  return automation?.action.kind === 'remind_followup'
    || automation?.action.kind === 'recap_person';
}

function seedActionMode(automation: Automation | null): ActionMode {
  if (!automation) return 'reminder';
  return automation.action.kind === 'wechat_summary' || automation.summarySpec
    ? 'summary'
    : 'reminder';
}

function seedState(automation: Automation | null): FormState {
  if (!automation) {
    return {
      name: '',
      kind: 'reminder_once',
      onceAt: defaultOnceAt(),
      cron: '0 9 * * *',
      cronLabel: '每天 09:00',
      message: '',
      actionMode: 'reminder',
    };
  }
  // 周期任务若存量 cron 不在引擎可运行的四种形态内（如每月/范围/列表，
  // 旧自由 cron 时代的遗留），归一到最近可运行形态——弹框不撒谎、保存即修复。
  const normalized = automation.kind === 'reminder_recurring' && !isSupportedRecurringCron(automation.cron)
    ? buildRecurringPatch(parseRecurringScheduleConfig(automation.cron))
    : { cron: automation.cron, cronLabel: automation.cronLabel };
  return {
    name: automation.name,
    kind: automation.kind,
    onceAt: automation.nextRunAt && automation.kind === 'reminder_once'
      ? automation.nextRunAt
      : defaultOnceAt(),
    cron: normalized.cron!,
    cronLabel: normalized.cronLabel!,
    message: automation.action.messageTemplate,
    actionMode: seedActionMode(automation),
  };
}

export function AutomationFormDialog({
  open,
  mode,
  automation,
  saving,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  automation: Automation | null;
  saving: boolean;
  onSubmit: (draft: AutomationDraft) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [state, setState] = React.useState<FormState>(() => seedState(automation));
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // 每次打开刷新「不早于现在+1 分钟」，打开期间稳定。
  const [minOnceAt, setMinOnceAt] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setState(seedState(automation));
      setMinOnceAt(datetimeLocalValue(Date.now() + 60_000));
      setError(null);
    }
  }, [open, automation]);

  const patch = (next: Partial<FormState>) => setState((prev) => ({ ...prev, ...next }));

  const switchKind = (kind: AutomationKind) => {
    if (kind === state.kind) return;
    if (kind === 'reminder_recurring') {
      // 归一成调度引擎支持的周期 cron（任意来源 cron → 最近的可运行形态）。
      const rec = buildRecurringPatch(parseRecurringScheduleConfig(state.cron));
      patch({ kind, cron: rec.cron!, cronLabel: rec.cronLabel! });
      return;
    }
    patch({ kind });
  };

  const submit = async () => {
    const name = state.name.trim();
    const message = state.message.trim();
    if (!name) return setError('请填写任务名称');
    if (!message) return setError('请填写提醒内容');
    if (state.kind === 'reminder_once' && state.onceAt <= Date.now()) {
      return setError('一次性任务的执行时间必须晚于现在');
    }
    setError(null);
    setSubmitting(true);
    try {
      const ok = await onSubmit(buildDraft(state, automation));
      if (ok) onOpenChange(false);
      else setError('保存失败，请重试；详细原因见页面顶部提示。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const busy = saving || submitting;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="w-[min(560px,calc(100vw-2rem))] sm:max-w-none">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '新建自动化' : '编辑自动化'}</DialogTitle>
          <DialogDescription className="text-xs">
            规则保存到本机；可执行的任务会接入调度并出现在运行记录里。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="任务名称" className="sm:col-span-2">
            <Input
              value={state.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="例如：每周五下班前提醒整理周报"
              autoFocus
            />
          </Field>

          <Field label="类型" className="sm:col-span-2">
            <div className="grid grid-cols-2 gap-2">
              {KIND_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => switchKind(option.value)}
                  className={cn(
                    'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                    state.kind === option.value
                      ? 'border-foreground/40 bg-foreground/[0.04]'
                      : 'border-border hover:bg-muted/40',
                  )}
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-[11px] text-muted-foreground">{option.hint}</span>
                </button>
              ))}
            </div>
          </Field>

          {isLinkedAction(automation) ? null : (
            <Field label="执行方式" className="sm:col-span-2">
              <div className="grid grid-cols-2 gap-2">
                {ACTION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => patch({ actionMode: option.value })}
                    className={cn(
                      'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                      state.actionMode === option.value
                        ? 'border-foreground/40 bg-foreground/[0.04]'
                        : 'border-border hover:bg-muted/40',
                    )}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-[11px] text-muted-foreground">{option.hint}</span>
                  </button>
                ))}
              </div>
              {state.actionMode === 'summary' ? (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                  会读取本机微信消息镜像并生成报告，运行耗时较长；不选则只是普通提醒。
                </p>
              ) : null}
            </Field>
          )}

          <AutomationScheduleFields
            value={state}
            minOnceAt={minOnceAt}
            onChange={(p) => patch(p)}
          />

          <Field
            label={state.actionMode === 'summary' ? '总结指令' : '提醒内容'}
            className="sm:col-span-2"
          >
            <Textarea
              value={state.message}
              onChange={(e) => patch({ message: e.target.value })}
              rows={3}
              placeholder={state.actionMode === 'summary'
                ? '给总结的指令，例如：汇总今天工作群消息，提炼重点/待办/需跟进的人；没有就说今日无工作'
                : '到点提醒你的内容，例如：下班前别忘了发周报给老板'}
              className="resize-none text-sm"
            />
          </Field>
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {mode === 'create' ? '创建' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildDraft(state: FormState, automation: Automation | null): AutomationDraft {
  const message = state.message.trim();
  const schedule = state.kind === 'reminder_once'
    ? buildOncePatch(state.onceAt)
    : { kind: 'reminder_recurring' as const, cron: state.cron.trim(), cronLabel: state.cronLabel.trim() };
  // 执行方式由用户显式选：总结 → wechat_summary；提醒 → custom。
  // 跟进/回顾联动 action 不改写，仅换文案，避免毁掉关联。
  const action: Automation['action'] = state.actionMode === 'summary'
    ? { kind: 'wechat_summary', messageTemplate: message }
    : isLinkedAction(automation)
      ? { ...automation!.action, messageTemplate: message }
      : { kind: 'custom', messageTemplate: message };
  return {
    name: state.name.trim(),
    kind: schedule.kind!,
    cron: schedule.cron!,
    cronLabel: schedule.cronLabel!,
    action,
    enabled: automation ? automation.enabled : true,
    nextRunAt: schedule.kind === 'reminder_once' ? state.onceAt : undefined,
    followupId: automation?.followupId,
  };
}
