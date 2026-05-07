'use client';

import * as React from 'react';
import { AlertCircle, Loader2, Plus, RefreshCw, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { FollowupDetail } from './FollowupDetail';
import { FollowupNewDialog } from './FollowupNewDialog';
import { SuggestedFollowupCards } from './SuggestedFollowupCards';
import { useWeChatContacts, type ContactRow } from './use-wechat-contacts';
import { displayWechatName, isLikelyGroupId } from './display-helpers';
import { formatDateTime } from './wechat-types';
import type {
  Automation,
  Followup,
  FollowupStatus,
  FollowupType,
  Person,
  SuggestedFollowup,
} from './relations-types';

const TYPE_LABEL: Record<FollowupType, string> = {
  reply: '待回复',
  commitment: '承诺',
  event: '事件',
  health: '健康',
  other: '其它',
};

const STATUS_LABEL: Record<FollowupStatus, string> = {
  open: '待处理',
  in_progress: '进行中',
  done: '已完成',
  archived: '已归档',
};

const STATUS_COLOR: Record<FollowupStatus, string> = {
  open: 'text-amber-600',
  in_progress: 'text-emerald-600',
  done: 'text-muted-foreground',
  archived: 'text-muted-foreground/60',
};

export function FollowupsTab({
  followups,
  people,
  automations,
  suggested,
  loading,
  saving,
  canRetrySave,
  analyzing,
  error,
  selectedId,
  onSelect,
  onRunAnalysis,
  onRetrySave,
  onUpdate,
  onDelete,
  onCreate,
  onCreateAutomation,
  onOpenAutomations,
  onAcceptSuggestion,
  onDismissSuggestion,
  defaultReminderHour,
}: {
  followups: Followup[];
  people: Person[];
  automations: Automation[];
  suggested: SuggestedFollowup[];
  loading: boolean;
  saving: boolean;
  canRetrySave: boolean;
  analyzing: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRunAnalysis: () => void;
  onRetrySave: () => Promise<boolean> | void;
  onUpdate: (id: string, patch: Partial<Followup>) => void;
  onDelete: (id: string) => void;
  onCreate: (draft: Omit<Followup, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCreateAutomation: (draft: Omit<Automation, 'id' | 'createdAt'>) => Promise<Automation | null>;
  onOpenAutomations: () => void;
  onAcceptSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
  defaultReminderHour: number;
}): React.ReactElement {
  const [createOpen, setCreateOpen] = React.useState(false);
  const contacts = useWeChatContacts();
  const contactRows = contacts.contacts;
  const contactsLoad = contacts.load;
  const selected = followups.find((f) => f.id === selectedId) ?? followups[0] ?? null;
  const peopleForFollowups = React.useMemo(
    () => mergeFollowupPeople(people, contactRows, followups, suggested),
    [people, contactRows, followups, suggested],
  );
  const open = followups.filter((f) => f.status === 'open' || f.status === 'in_progress');
  const done = followups.filter((f) => f.status === 'done' || f.status === 'archived');

  React.useEffect(() => {
    if (createOpen) void contactsLoad();
  }, [createOpen, contactsLoad]);

  React.useEffect(() => {
    if (!selected) return;
    if (contacts.ready || contacts.loading) return;
    const known = new Set(people.map((person) => person.id));
    if (selected.involvedPersonIds.some((id) => !known.has(id))) {
      void contactsLoad();
    }
  }, [contacts.ready, contacts.loading, contactsLoad, people, selected]);

  return (
    <div className="flex flex-col gap-10">
      <SaveBanner
        saving={saving}
        canRetrySave={canRetrySave}
        error={error}
        onRetry={onRetrySave}
      />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">AI 推荐</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              根据微信消息识别出的可能跟进。采纳后进入下方清单。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saving ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                保存中
              </span>
            ) : null}
            <Button size="sm" variant="outline" onClick={onRunAnalysis} disabled={analyzing}>
              {analyzing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {analyzing ? '分析中' : '分析微信消息'}
            </Button>
            {suggested.length > 0 ? (
              <span className="text-xs text-muted-foreground">{suggested.length} 条候选</span>
            ) : null}
          </div>
        </div>
        {error && !canRetrySave ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        {loading ? (
          <Card className="border-dashed">
            <CardContent className="flex min-h-20 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              加载跟进中…
            </CardContent>
          </Card>
        ) : (
          <SuggestedFollowupCards
            items={suggested}
            people={peopleForFollowups}
            onAccept={onAcceptSuggestion}
            onDismiss={onDismissSuggestion}
          />
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-5">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">进行中</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{open.length} 件</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" />
              新建
            </Button>
          </div>
          {open.length === 0 ? (
            <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
              没有进行中的事
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {open.map((f) => (
                <FollowupListRow
                  key={f.id}
                  followup={f}
                  active={f.id === selected?.id}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
          {done.length > 0 ? (
            <details className="group rounded-lg">
              <summary className="flex cursor-pointer list-none items-center justify-between px-1 py-2 text-xs text-muted-foreground hover:text-foreground">
                <span>已完成</span>
                <span className="tabular-nums">{done.length}</span>
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {done.map((f) => (
                  <FollowupListRow
                    key={f.id}
                    followup={f}
                    active={f.id === selected?.id}
                    onSelect={onSelect}
                    muted
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </aside>

        {selected ? (
          <FollowupDetail
            followup={selected}
            people={peopleForFollowups}
            automations={automations}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onCreateAutomation={onCreateAutomation}
            onOpenAutomations={onOpenAutomations}
            defaultReminderHour={defaultReminderHour}
          />
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex min-h-60 items-center justify-center text-sm text-muted-foreground">
              没有跟进 · 点新建添加
            </CardContent>
          </Card>
        )}

        <FollowupNewDialog
          open={createOpen}
          people={peopleForFollowups}
          onOpenChange={setCreateOpen}
          onCreate={onCreate}
        />
      </div>
    </div>
  );
}

function SaveBanner({
  saving,
  canRetrySave,
  error,
  onRetry,
}: {
  saving: boolean;
  canRetrySave: boolean;
  error: string | null;
  onRetry: () => Promise<boolean> | void;
}) {
  if (!saving && !canRetrySave) return null;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs',
        canRetrySave
          ? 'border border-destructive/30 bg-destructive/5 text-destructive'
          : 'border border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {canRetrySave ? (
          <AlertCircle className="size-3.5 shrink-0" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        )}
        <span className="min-w-0 break-words">
          {canRetrySave ? `保存失败：${error ?? '请重试保存。'}` : '保存中'}
        </span>
      </span>
      {canRetrySave ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void onRetry()}
          className="h-7 shrink-0 px-2 text-xs text-current hover:bg-current/10 hover:text-current"
        >
          <RefreshCw className="size-3.5" />
          重试保存
        </Button>
      ) : null}
    </div>
  );
}

function FollowupListRow({
  followup,
  active,
  onSelect,
  muted,
}: {
  followup: Followup;
  active: boolean;
  onSelect: (id: string) => void;
  muted?: boolean;
}) {
  const [now] = React.useState(() => Date.now());
  const dueLabel = followup.dueAt ? formatDueLabel(followup.dueAt, now) : null;
  const overdue = !!followup.dueAt && followup.dueAt < now && followup.status !== 'done';
  const dot = overdue
    ? 'bg-rose-500'
    : followup.status === 'open'
      ? 'bg-amber-500'
      : followup.status === 'in_progress'
        ? 'bg-emerald-500'
        : 'bg-muted-foreground/40';
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(followup.id)}
        className={cn(
          'group flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors',
          active ? 'bg-muted' : 'hover:bg-muted/50',
          muted && 'opacity-60',
        )}
      >
        <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', dot)} />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate text-sm font-medium',
              followup.status === 'done' && 'line-through decoration-muted-foreground/40',
            )}
          >
            {followup.title}
          </p>
          <p className="mt-0.5 flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
            <span>{TYPE_LABEL[followup.type]}</span>
            {dueLabel ? (
              <span className={cn(overdue && 'text-rose-600')}>· {dueLabel}</span>
            ) : (
              <span className={STATUS_COLOR[followup.status]}>· {STATUS_LABEL[followup.status]}</span>
            )}
          </p>
        </div>
      </button>
    </li>
  );
}

function formatDueLabel(ts: number, now: number): string {
  const diff = ts - now;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 0) return `逾期 ${Math.round(-diff / day)} 天`;
  if (diff < day) return '今天到期';
  if (diff < 2 * day) return '明天到期';
  return formatDateTime(ts);
}

export { TYPE_LABEL as FOLLOWUP_TYPE_LABEL, STATUS_LABEL as FOLLOWUP_STATUS_LABEL };

function mergeFollowupPeople(
  overviewPeople: Person[],
  contacts: ContactRow[],
  followups: Followup[],
  suggested: SuggestedFollowup[],
): Person[] {
  const byId = new Map<string, Person>();
  for (const person of overviewPeople) byId.set(person.id, person);
  for (const contact of contacts) {
    if (!byId.has(contact.id)) byId.set(contact.id, contactToPerson(contact));
  }
  for (const id of followups.flatMap((item) => item.involvedPersonIds)) {
    if (!byId.has(id)) byId.set(id, fallbackPerson(id));
  }
  for (const id of suggested.flatMap((item) => item.involvedPersonIds)) {
    if (!byId.has(id)) byId.set(id, fallbackPerson(id));
  }
  return Array.from(byId.values());
}

function contactToPerson(contact: ContactRow): Person {
  return {
    id: contact.id,
    wxid: contact.id,
    name: contact.name,
    isGroup: contact.isGroup,
    groups: contact.isGroup ? ['colleague'] : ['friend'],
    totalMessages30d: 0,
    yourShare30d: 0,
    lastInteractionTs: 0,
    interactionDays: emptyInteractionDays(),
    topWords: [],
    toneTags: [contact.isGroup ? '群聊' : '联系人'],
  };
}

function fallbackPerson(id: string): Person {
  const isGroup = isLikelyGroupId(id);
  return {
    id,
    wxid: id,
    name: displayWechatName(null, id),
    isGroup,
    groups: isGroup ? ['colleague'] : ['friend'],
    totalMessages30d: 0,
    yourShare30d: 0,
    lastInteractionTs: 0,
    interactionDays: emptyInteractionDays(),
    topWords: [],
    toneTags: [isGroup ? '群聊' : '联系人'],
  };
}

function emptyInteractionDays() {
  return Array.from({ length: 14 }, (_, daysAgo) => ({ daysAgo, count: 0 }));
}
