'use client';

import { useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useKnowledgeCacheStore, type KnowledgeTag } from '@/stores/knowledge-cache-store';

interface KnowledgeTagsPanelProps {
  selectedTagIds: string[];
  onSelectedTagIdsChange: (ids: string[]) => void;
  tagFilter: string;
  onFilterChange: (value: string) => void;
}

export function KnowledgeTagsPanel({
  selectedTagIds,
  onSelectedTagIdsChange,
  tagFilter,
  onFilterChange,
}: KnowledgeTagsPanelProps) {
  const { t } = useTranslation();
  const tagsResource = useKnowledgeCacheStore((s) => s.tags);
  const loadTags = useKnowledgeCacheStore((s) => s.loadTags);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const tags = useMemo(() => tagsResource.value ?? [], [tagsResource.value]);
  const selectedSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);

  const filteredTags = useMemo(() => {
    const q = tagFilter.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((tag) => tag.name.toLowerCase().includes(q) || tag.category.toLowerCase().includes(q));
  }, [tagFilter, tags]);

  const selectedTags = useMemo(
    () => tags.filter((tag) => selectedSet.has(tag.id)),
    [tags, selectedSet],
  );

  const toggleTag = (tagId: string) => {
    if (selectedSet.has(tagId)) {
      onSelectedTagIdsChange(selectedTagIds.filter((id) => id !== tagId));
    } else {
      onSelectedTagIdsChange([...selectedTagIds, tagId]);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div>
          <div className="text-xs font-medium text-foreground">{t('messageInput.knowledgeTags')}</div>
          <div className="text-[11px] text-muted-foreground">
            {selectedTagIds.length > 0
              ? t('messageInput.knowledgeTagsSelected').replace('{n}', String(selectedTagIds.length))
              : t('messageInput.knowledgeAllTags')}
          </div>
        </div>
        {selectedTagIds.length > 0 && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onSelectedTagIdsChange([])}
          >
            {t('messageInput.knowledgeClearTags')}
          </button>
        )}
      </div>

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">
          {selectedTags.map((tag) => (
            <SelectedTagChip key={`selected-${tag.id}`} tag={tag} onToggle={() => toggleTag(tag.id)} />
          ))}
        </div>
      )}

      <div className="border-b px-3 py-2">
        <input
          type="text"
          value={tagFilter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={t('messageInput.knowledgeFilterPlaceholder')}
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-ring"
        />
      </div>

      <TagsList
        tagsLoading={tagsResource.loading && !tagsResource.loaded}
        tagsError={tagsResource.error}
        tags={tags}
        filteredTags={filteredTags}
        selectedSet={selectedSet}
        onToggleTag={toggleTag}
        onRetry={() => loadTags(true)}
      />
    </>
  );
}

function SelectedTagChip({ tag, onToggle }: { tag: KnowledgeTag; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
      <span className="max-w-[140px] truncate">{tag.name}</span>
    </button>
  );
}

interface TagsListProps {
  tagsLoading: boolean;
  tagsError: string | null;
  tags: KnowledgeTag[];
  filteredTags: KnowledgeTag[];
  selectedSet: Set<string>;
  onToggleTag: (id: string) => void;
  onRetry: () => void;
}

function TagsList({ tagsLoading, tagsError, tags, filteredTags, selectedSet, onToggleTag, onRetry }: TagsListProps) {
  const { t } = useTranslation();

  if (tagsLoading) {
    return (
      <div className="px-2 py-3 text-xs text-muted-foreground">
        {t('messageInput.knowledgeLoadingTags')}
      </div>
    );
  }

  if (tagsError) {
    return (
      <div className="space-y-2 px-2 py-3">
        <div className="text-xs text-destructive">{t('messageInput.knowledgeLoadTagsFailed')}</div>
        <button
          type="button"
          className="text-xs text-foreground underline underline-offset-2"
          onClick={onRetry}
        >
          {t('install.retry')}
        </button>
      </div>
    );
  }

  if (filteredTags.length === 0) {
    return (
      <div className="px-2 py-3 text-xs text-muted-foreground">
        {tags.length === 0
          ? t('messageInput.knowledgeNoTags')
          : t('messageInput.knowledgeNoFilteredTags')}
      </div>
    );
  }

  return (
    <div className="max-h-52 overflow-y-auto p-2">
      <div className="flex flex-wrap gap-2">
        {filteredTags.map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            selected={selectedSet.has(tag.id)}
            onToggle={() => onToggleTag(tag.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TagChip({ tag, selected, onToggle }: { tag: KnowledgeTag; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors',
        selected
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-border bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
      <span className="truncate">{tag.name}</span>
      {typeof tag.usage_count === 'number' && tag.usage_count > 0 && (
        <span className="text-[10px] opacity-70">{tag.usage_count}</span>
      )}
    </button>
  );
}
