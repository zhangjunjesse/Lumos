'use client';

import * as React from 'react';
import { ListChecks, Settings2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { BuilderStory, BuilderStoryStatus } from '@/lib/app/builder/session';
import { cn } from '@/lib/utils';

import { AcceptanceList, AdvancedFields, DetailChip, countAdvanced } from './card-sections';
import { ConfirmationActions } from './ConfirmationActions';
import { STATUS_META, StoryStatusBadge, formatRelativeTime, isConfirmedStatus } from './status-meta';

interface StoryCardProps {
  story: BuilderStory;
  index: number;
  saving: boolean;
  onChange: (patch: Partial<BuilderStory>) => void;
  onSave: () => void;
  onSaveWith: (story: BuilderStory) => void;
  onDelete: () => void;
}

export function StoryCard({
  story,
  index,
  saving,
  onChange,
  onSave,
  onSaveWith,
  onDelete,
}: StoryCardProps): React.ReactElement {
  const meta = STATUS_META[story.status];
  const fingerprint = serializeStory(story);
  const [baseline, setBaseline] = React.useState(() => ({
    updatedAt: story.updatedAt,
    fingerprint,
  }));
  if (baseline.updatedAt !== story.updatedAt) {
    setBaseline({ updatedAt: story.updatedAt, fingerprint });
  }
  const isDirty = fingerprint !== baseline.fingerprint;

  const [showCriteria, setShowCriteria] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const handleSetStatus = (next: BuilderStoryStatus) => {
    onChange({ status: next });
    onSaveWith({ ...story, status: next });
  };
  const handleBlurSave = () => {
    if (saving || !isDirty) return;
    onSave();
  };

  return (
    <article className={cn(cardToneClass(story.status), CARD_BASE)}>
      <div className={cn('absolute inset-x-0 top-0 h-0.5', meta.divider)} />

      <header className="flex items-center justify-between gap-2 px-5 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
            #{String(index + 1).padStart(2, '0')}
          </span>
          <StoryStatusBadge status={story.status} variant="solid" />
          <span className="truncate text-[10px] text-muted-foreground/70">
            {saving ? '保存中…' : isDirty ? '未保存' : formatRelativeTime(story.updatedAt)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {isDirty ? (
            <Button size="sm" variant="ghost" onClick={onSave} disabled={saving} className="h-7 px-2 text-xs">
              保存
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onDelete}
            disabled={saving}
            aria-label="删除需求"
            className="size-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col px-5 pb-4 pt-2.5">
        <Input
          value={story.title}
          onChange={(event) => onChange({ title: event.target.value })}
          onBlur={handleBlurSave}
          placeholder="一句话说明这条需求"
          className={cn(
            'h-auto border-0 bg-transparent p-0 text-[17px] font-semibold leading-snug tracking-tight shadow-none',
            'placeholder:text-muted-foreground/40 focus-visible:ring-0',
          )}
          maxLength={160}
        />

        <Textarea
          value={story.storyText}
          onChange={(event) => onChange({ storyText: event.target.value })}
          onBlur={handleBlurSave}
          placeholder="作为某类用户，我希望完成某件事，这样获得某个结果。"
          className={cn(
            'mt-2 min-h-0 resize-none border-0 bg-transparent p-0 text-sm leading-6 shadow-none',
            'text-muted-foreground placeholder:text-muted-foreground/40 focus-visible:ring-0',
          )}
          rows={3}
          maxLength={2000}
        />

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <DetailChip
              icon={ListChecks}
              label="验收"
              count={story.acceptanceCriteria.length}
              open={showCriteria}
              onClick={() => setShowCriteria((current) => !current)}
            />
            <DetailChip
              icon={Settings2}
              label="角色 / 目标 / 价值"
              count={countAdvanced(story)}
              open={showAdvanced}
              onClick={() => setShowAdvanced((current) => !current)}
            />
          </div>
          <ConfirmationActions
            status={story.status}
            saving={saving}
            onChangeStatus={handleSetStatus}
          />
        </div>

        {showCriteria ? (
          <AcceptanceList
            items={story.acceptanceCriteria}
            onChange={(items) => onChange({ acceptanceCriteria: items })}
            onBlurSave={handleBlurSave}
          />
        ) : null}

        {showAdvanced ? (
          <AdvancedFields
            story={story}
            onChange={onChange}
            onBlurSave={handleBlurSave}
          />
        ) : null}
      </div>
    </article>
  );
}

const CARD_BASE = 'group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md';

function cardToneClass(status: BuilderStoryStatus): string {
  if (isConfirmedStatus(status)) {
    return 'border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.04] via-card to-card';
  }
  if (status === 'deferred') {
    return 'border-dashed border-muted-foreground/20 bg-muted/20';
  }
  if (status === 'pending_confirmation') {
    return 'border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] via-card to-card';
  }
  return 'border-border';
}

function serializeStory(s: BuilderStory): string {
  return JSON.stringify({
    title: s.title,
    storyText: s.storyText,
    actor: s.actor ?? null,
    goal: s.goal ?? null,
    benefit: s.benefit ?? null,
    status: s.status,
    priority: s.priority,
    acceptanceCriteria: s.acceptanceCriteria,
    relatedPages: s.relatedPages,
    relatedCollections: s.relatedCollections,
  });
}
