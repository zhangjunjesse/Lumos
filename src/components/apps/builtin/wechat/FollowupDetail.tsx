'use client';

import * as React from 'react';
import { Bell, Check, ExternalLink, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { FOLLOWUP_STATUS_LABEL, FOLLOWUP_TYPE_LABEL } from './FollowupsTab';
import { formatDateTime } from './wechat-types';
import type {
  Automation,
  Followup,
  FollowupStatus,
  Person,
} from './relations-types';

const STATUS_OPTIONS: FollowupStatus[] = ['open', 'in_progress', 'done', 'archived'];

export function FollowupDetail({
  followup,
  people,
  automations,
  onUpdate,
  onDelete,
  onCreateAutomation,
  onOpenAutomations,
  defaultReminderHour,
}: {
  followup: Followup;
  people: Person[];
  automations: Automation[];
  onUpdate: (id: string, patch: Partial<Followup>) => void;
  onDelete: (id: string) => void;
  onCreateAutomation: (draft: Omit<Automation, 'id' | 'createdAt'>) => Promise<Automation | null>;
  onOpenAutomations: () => void;
  defaultReminderHour: number;
}): React.ReactElement {
  const [reminderOpen, setReminderOpen] = React.useState(false);
  const [reminderAt, setReminderAt] = React.useState('');
  const [reminderMessage, setReminderMessage] = React.useState('');
  const [reminderError, setReminderError] = React.useState<string | null>(null);
  const [reminderFeedback, setReminderFeedback] = React.useState<string | null>(null);
  const [creatingReminder, setCreatingReminder] = React.useState(false);
  const [minReminderAt] = React.useState(() => datetimeLocalValue(Date.now() + 60_000));
  const involved = people.filter((p) => followup.involvedPersonIds.includes(p.id));
  const linkedAutomations = automations.filter((a) =>
    followup.automationIds.includes(a.id) || a.followupId === followup.id,
  );

  const openReminderDialog = () => {
    setReminderAt(datetimeLocalValue(defaultReminderTs(followup, defaultReminderHour)));
    setReminderMessage(followup.nextStep || followup.title);
    setReminderError(null);
    setReminderFeedback(null);
    setReminderOpen(true);
  };

  const createReminder = async () => {
    const nextRunAt = parseDatetimeLocal(reminderAt);
    if (!nextRunAt) {
      setReminderError('请选择提醒时间');
      return;
    }
    if (nextRunAt <= Date.now() + 30_000) {
      setReminderError('提醒时间需要晚于当前时间');
      return;
    }
    const messageTemplate = reminderMessage.trim() || followup.nextStep || followup.title;
    setReminderError(null);
    setCreatingReminder(true);
    const automation = await onCreateAutomation({
      name: `${followup.title} · 提醒`,
      kind: 'reminder_once',
      cron: cronFromTimestamp(nextRunAt),
      cronLabel: `一次性 · ${oneTimeLabel(nextRunAt)}`,
      action: {
        kind: 'remind_followup',
        followupId: followup.id,
        messageTemplate,
      },
      enabled: true,
      nextRunAt,
      followupId: followup.id,
    }).catch(() => null);
    setCreatingReminder(false);
    if (!automation) {
      setReminderError('创建失败，请查看页面上的错误提示');
      return;
    }
    setReminderFeedback(
      automation.scheduleError
        ? `已保存提醒规则：${automation.scheduleError}`
        : `已创建提醒：${oneTimeLabel(nextRunAt)}`,
    );
    setReminderOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3 border-b pb-5">
        <div className="flex items-baseline justify-between gap-3">
          <Input
            value={followup.title}
            onChange={(e) => onUpdate(followup.id, { title: e.target.value })}
            className="border-0 bg-transparent px-0 text-2xl font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(followup.id)}
            className="text-muted-foreground hover:text-rose-600"
          >
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <Pill label="类型" value={FOLLOWUP_TYPE_LABEL[followup.type]} />
          <StatusToggle status={followup.status} onChange={(s) => onUpdate(followup.id, { status: s })} />
          {followup.dueAt ? <Pill label="截止" value={formatDateTime(followup.dueAt)} /> : null}
          <span>· 更新于 {formatDateTime(followup.updatedAt)}</span>
        </div>
      </header>

      <Section title="概览">
        <Textarea
          value={followup.summary}
          onChange={(e) => onUpdate(followup.id, { summary: e.target.value })}
          rows={3}
          className="resize-none border bg-card"
        />
      </Section>

      <Section title="下一步">
        <Input
          value={followup.nextStep}
          onChange={(e) => onUpdate(followup.id, { nextStep: e.target.value })}
          className="bg-card"
        />
      </Section>

      {involved.length > 0 ? (
        <Section title="涉及">
          <div className="flex flex-wrap gap-2">
            {involved.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-baseline gap-1.5 rounded-full border bg-card px-3 py-1 text-xs"
              >
                <span className="font-medium">{p.name}</span>
                {p.toneTags[0] ? <span className="text-[10px] text-muted-foreground">· {p.toneTags[0]}</span> : null}
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      {followup.dialogueRefs.length > 0 ? (
        <Section title="对话引用">
          <Card>
            <CardContent className="flex flex-col p-3">
              {followup.dialogueRefs.map((d, i) => (
                <div
                  key={i}
                  className={cn('flex gap-3 py-2 text-sm', i > 0 && 'border-t')}
                >
                  <span className="w-20 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatDateTime(d.ts)}
                  </span>
                  <span className="w-12 shrink-0 truncate text-[11px] text-muted-foreground">
                    {d.who}
                  </span>
                  <span className="min-w-0 break-words leading-6">{d.text}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </Section>
      ) : null}

      <Section title="自动化">
        {linkedAutomations.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {linkedAutomations.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
              >
                <span className="flex items-baseline gap-2">
                  <Bell className="size-3.5 text-muted-foreground" />
                  <span>{a.name}</span>
                </span>
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>{a.nextRunAt ? `下次 ${formatDateTime(a.nextRunAt)}` : a.cronLabel}</span>
                  {a.scheduleId ? (
                    <span className="text-emerald-600">已接入调度</span>
                  ) : a.scheduleError ? (
                    <span className="text-amber-600">仅保存规则</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed bg-card/40 px-3 py-3 text-xs text-muted-foreground">
            还没有为这件事设置提醒
          </p>
        )}
        {reminderFeedback ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <Check className="size-3.5" />
            <span>{reminderFeedback}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onOpenAutomations}>
              <ExternalLink className="size-3.5" />
              去自动化查看
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={openReminderDialog}
          >
            <Bell className="size-3.5" />
            挂个提醒
          </Button>
          {linkedAutomations.length > 0 ? (
            <Button variant="ghost" size="sm" className="w-fit" onClick={onOpenAutomations}>
              <ExternalLink className="size-3.5" />
              查看自动化
            </Button>
          ) : null}
        </div>
      </Section>

      <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-base font-medium tracking-tight">设置提醒</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">提醒时间</Label>
              <Input
                type="datetime-local"
                value={reminderAt}
                min={minReminderAt}
                onChange={(event) => {
                  setReminderAt(event.target.value);
                  setReminderError(null);
                }}
                className="tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">提醒内容</Label>
              <Textarea
                value={reminderMessage}
                onChange={(event) => setReminderMessage(event.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>
            {reminderError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {reminderError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReminderOpen(false)} disabled={creatingReminder}>
              取消
            </Button>
            <Button onClick={() => void createReminder()} disabled={creatingReminder}>
              {creatingReminder ? <Loader2 className="size-3.5 animate-spin" /> : <Bell className="size-3.5" />}
              创建提醒
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-sm font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted-foreground/70">{label} </span>
      <span className="text-foreground">{value}</span>
    </span>
  );
}

function StatusToggle({
  status,
  onChange,
}: {
  status: FollowupStatus;
  onChange: (s: FollowupStatus) => void;
}) {
  const dotClass =
    status === 'open'
      ? 'bg-amber-500'
      : status === 'in_progress'
        ? 'bg-emerald-500'
        : status === 'done'
          ? 'bg-muted-foreground/40'
          : 'bg-muted-foreground/20';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-1.5 rounded-full', dotClass)} />
      <Select value={status} onValueChange={(v) => onChange(v as FollowupStatus)}>
        <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent px-1 py-0 text-[11px] hover:bg-muted/50 focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {FOLLOWUP_STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {status === 'in_progress' ? (
        <button
          type="button"
          onClick={() => onChange('done')}
          className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-emerald-600 hover:text-emerald-700"
        >
          <Check className="size-3" />
          完成
        </button>
      ) : status === 'open' ? (
        <button
          type="button"
          onClick={() => onChange('in_progress')}
          className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-emerald-600 hover:text-emerald-700"
        >
          开始
        </button>
      ) : null}
    </span>
  );
}

function defaultReminderTs(followup: Followup, defaultHour: number): number {
  if (followup.dueAt && followup.dueAt > Date.now() + 60_000) return followup.dueAt;
  return nextReminderTs(defaultHour);
}

function nextReminderTs(hour: number): number {
  const normalizedHour = Math.max(0, Math.min(23, Math.floor(hour)));
  const d = new Date();
  d.setHours(normalizedHour, 0, 0, 0);
  if (d.getTime() <= Date.now() + 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function datetimeLocalValue(ts?: number): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return '';
  return [
    date.getFullYear(),
    '-',
    pad2(date.getMonth() + 1),
    '-',
    pad2(date.getDate()),
    'T',
    pad2(date.getHours()),
    ':',
    pad2(date.getMinutes()),
  ].join('');
}

function parseDatetimeLocal(value: string): number | null {
  if (!value.trim()) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function oneTimeLabel(ts: number): string {
  const date = new Date(ts);
  return [
    date.getFullYear(),
    '-',
    pad2(date.getMonth() + 1),
    '-',
    pad2(date.getDate()),
    ' ',
    pad2(date.getHours()),
    ':',
    pad2(date.getMinutes()),
  ].join('');
}

function cronFromTimestamp(ts: number): string {
  const date = new Date(ts);
  return `${date.getMinutes()} ${date.getHours()} * * *`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
