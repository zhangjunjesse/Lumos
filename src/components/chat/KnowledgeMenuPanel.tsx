'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { KnowledgeOverrides } from '@/types';
import { KnowledgeTagsPanel } from './KnowledgeTagsPanel';
import { KnowledgeParamsPanel } from './KnowledgeParamsPanel';

interface KnowledgeMenuPanelProps {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  selectedTagIds: string[];
  onSelectedTagIdsChange: (ids: string[]) => void;
  overrides: KnowledgeOverrides;
  onOverridesChange: (next: KnowledgeOverrides) => void;
}

type Tab = 'tags' | 'params';

export function KnowledgeMenuPanel({
  enabled,
  onEnabledChange,
  selectedTagIds,
  onSelectedTagIdsChange,
  overrides,
  onOverridesChange,
}: KnowledgeMenuPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('tags');
  const [tagFilter, setTagFilter] = useState('');

  const overrideCount = countOverrides(overrides);

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-3 py-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">{t('messageInput.knowledgeBase')}</div>
          <div className="text-xs text-muted-foreground">
            {enabled ? t('messageInput.knowledgeEnabledHint') : t('messageInput.knowledgeDisabledHint')}
          </div>
        </div>
        <MasterSwitch enabled={enabled} onChange={onEnabledChange} />
      </div>

      {enabled && (
        <>
          <div className="flex border-b">
            <TabButton
              active={activeTab === 'tags'}
              onClick={() => setActiveTab('tags')}
              label={t('messageInput.knowledgeTabTags')}
              badge={selectedTagIds.length > 0 ? String(selectedTagIds.length) : null}
            />
            <TabButton
              active={activeTab === 'params'}
              onClick={() => setActiveTab('params')}
              label={t('messageInput.knowledgeTabParams')}
              badge={overrideCount > 0
                ? t('messageInput.knowledgeOverrideCount').replace('{n}', String(overrideCount))
                : null}
            />
          </div>

          {activeTab === 'tags' ? (
            <KnowledgeTagsPanel
              selectedTagIds={selectedTagIds}
              onSelectedTagIdsChange={onSelectedTagIdsChange}
              tagFilter={tagFilter}
              onFilterChange={setTagFilter}
            />
          ) : (
            <KnowledgeParamsPanel
              overrides={overrides}
              onOverridesChange={onOverridesChange}
            />
          )}
        </>
      )}
    </div>
  );
}

function MasterSwitch({ enabled, onChange }: { enabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      aria-pressed={enabled}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
        enabled
          ? 'border-emerald-500/40 bg-emerald-500/20'
          : 'border-border bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
          enabled ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
        active
          ? 'border-b-2 border-emerald-500 text-foreground'
          : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      {badge !== null && (
        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] leading-none text-emerald-700 dark:text-emerald-300">
          {badge}
        </span>
      )}
    </button>
  );
}

function countOverrides(overrides: KnowledgeOverrides): number {
  return (Object.keys(overrides) as Array<keyof KnowledgeOverrides>)
    .filter((k) => overrides[k] !== undefined).length;
}
