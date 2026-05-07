'use client';

import * as React from 'react';
import { ClipboardList, Plus, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { BuilderStory, BuilderStoryStatus } from '@/lib/app/builder/session';
import { cn } from '@/lib/utils';

import { NonGoalsBar } from './requirements/NonGoalsBar';
import { StoryCard } from './requirements/StoryCard';
import { isConfirmedStatus } from './requirements/status-meta';

type FilterKey = 'all' | 'pending_confirmation' | 'confirmed' | 'deferred';

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending_confirmation', label: '待确认' },
  { key: 'confirmed', label: '已确认' },
  { key: 'deferred', label: '暂不做' },
];

function isPending(status: BuilderStoryStatus): boolean {
  return status === 'pending_confirmation' || status === 'draft';
}

interface RequirementsPanelProps {
  stories: BuilderStory[];
  creating: boolean;
  savingStoryId: string;
  nonGoals: string[];
  savingNonGoals: boolean;
  onCreateStory: () => void;
  onChangeStory: (storyId: string, patch: Partial<BuilderStory>) => void;
  onSaveStory: (story: BuilderStory) => void;
  onDeleteStory: (storyId: string) => void;
  onChangeNonGoals: (next: string[]) => void;
}

export function RequirementsPanel({
  stories,
  creating,
  savingStoryId,
  nonGoals,
  savingNonGoals,
  onCreateStory,
  onChangeStory,
  onSaveStory,
  onDeleteStory,
  onChangeNonGoals,
}: RequirementsPanelProps): React.ReactElement {
  const [filter, setFilter] = React.useState<FilterKey>('all');

  const counts = React.useMemo(() => {
    const result: Record<FilterKey, number> = {
      all: stories.length,
      pending_confirmation: 0,
      confirmed: 0,
      deferred: 0,
    };
    for (const story of stories) {
      if (isConfirmedStatus(story.status)) result.confirmed += 1;
      else if (isPending(story.status)) result.pending_confirmation += 1;
      else if (story.status === 'deferred') result.deferred += 1;
    }
    return result;
  }, [stories]);

  const visibleStories = React.useMemo(() => {
    if (filter === 'all') return stories;
    if (filter === 'confirmed') return stories.filter((s) => isConfirmedStatus(s.status));
    if (filter === 'pending_confirmation') return stories.filter((s) => isPending(s.status));
    if (filter === 'deferred') return stories.filter((s) => s.status === 'deferred');
    return stories;
  }, [filter, stories]);

  const indexById = React.useMemo(() => {
    const map = new Map<string, number>();
    stories.forEach((story, index) => map.set(story.id, index));
    return map;
  }, [stories]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <header className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background/85 px-6 py-4 backdrop-blur-md">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">需求清单</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                逐条阅读并确认，AI 会按照已确认的需求生成应用
              </p>
            </div>
          </div>
          <Button size="sm" onClick={onCreateStory} disabled={creating} className="shrink-0">
            <Plus data-icon="inline-start" />
            {creating ? '新增中…' : '新增需求'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <FilterChip
              key={option.key}
              label={option.label}
              count={counts[option.key]}
              active={filter === option.key}
              onClick={() => setFilter(option.key)}
            />
          ))}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-5 py-5 lg:px-8 lg:py-6">
          <NonGoalsBar
            items={nonGoals}
            saving={savingNonGoals}
            onChange={onChangeNonGoals}
          />

          {stories.length === 0 ? (
            <RequirementEmptyState onCreateStory={onCreateStory} creating={creating} />
          ) : visibleStories.length === 0 ? (
            <FilterEmptyState onClearFilter={() => setFilter('all')} />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {visibleStories.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  index={indexById.get(story.id) ?? 0}
                  saving={savingStoryId === story.id}
                  onChange={(patch) => onChangeStory(story.id, patch)}
                  onSave={() => onSaveStory(story)}
                  onSaveWith={onSaveStory}
                  onDelete={() => onDeleteStory(story.id)}
                />
              ))}
              <button
                type="button"
                onClick={onCreateStory}
                disabled={creating}
                className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-dashed bg-transparent px-6 py-5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
              >
                <Plus className="size-4" />
                {creating ? '新增中…' : '新增一条需求'}
              </button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums',
          active
            ? 'bg-primary-foreground/20 text-primary-foreground'
            : 'bg-background/80 text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function FilterEmptyState({
  onClearFilter,
}: {
  onClearFilter: () => void;
}): React.ReactElement {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/10 px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">没有符合当前筛选的需求</p>
      <Button variant="link" size="sm" onClick={onClearFilter} className="mt-1">
        查看全部
      </Button>
    </div>
  );
}

function RequirementEmptyState({
  creating,
  onCreateStory,
}: {
  creating: boolean;
  onCreateStory: () => void;
}): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="relative mx-auto flex size-16 items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 blur-xl" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/20">
            <ClipboardList className="size-6" />
          </div>
        </div>
        <h3 className="mt-5 text-base font-semibold tracking-tight">先聊聊你想做什么</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          在底部和应用开发助手描述你的应用想法，AI 会自动梳理成一条条需求。
          也可以手动新增第一条。
        </p>
        <Button className="mt-6" size="sm" onClick={onCreateStory} disabled={creating}>
          <Plus data-icon="inline-start" />
          {creating ? '新增中…' : '手动新增需求'}
        </Button>
      </div>
    </div>
  );
}
