'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useKnowledgeCacheStore, type KnowledgeDefaults } from '@/stores/knowledge-cache-store';
import type { KnowledgeOverrides, KnowledgeRetrievalMode } from '@/types';
import { ChipRow, ModeButton, ParamRow, RewriteSwitch } from './knowledge-param-controls';

const TOP_K_OPTIONS = [3, 4, 6, 8, 10] as const;
const CANDIDATE_POOL_OPTIONS = [24, 32, 40, 48, 64, 80] as const;

interface KnowledgeParamsPanelProps {
  overrides: KnowledgeOverrides;
  onOverridesChange: (next: KnowledgeOverrides) => void;
}

export function KnowledgeParamsPanel({ overrides, onOverridesChange }: KnowledgeParamsPanelProps) {
  const { t } = useTranslation();
  const defaultsResource = useKnowledgeCacheStore((s) => s.defaults);
  const loadDefaults = useKnowledgeCacheStore((s) => s.loadDefaults);

  useEffect(() => {
    void loadDefaults();
  }, [loadDefaults]);

  // M1 fix: when defaults arrive (or change), prune stale overrides that match the default.
  useEffect(() => {
    const defaults = defaultsResource.value;
    if (!defaults) return;
    const next = pruneStaleOverrides(overrides, defaults);
    if (next !== overrides) onOverridesChange(next);
    // intentionally only react to defaults-load events, not to every overrides change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsResource.value]);

  const defaults = defaultsResource.value;
  const isLoading = defaultsResource.loading && !defaultsResource.loaded;
  const isError = !defaults && defaultsResource.loaded;

  if (isLoading) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        {t('messageInput.knowledgeLoadingDefaults')}
      </div>
    );
  }

  if (isError || !defaults) {
    return (
      <div className="space-y-2 px-3 py-6 text-center">
        <div className="text-xs text-destructive">{t('messageInput.knowledgeLoadDefaultsFailed')}</div>
        <button
          type="button"
          className="text-xs text-foreground underline underline-offset-2"
          onClick={() => loadDefaults(true)}
        >
          {t('install.retry')}
        </button>
      </div>
    );
  }

  return <ParamsForm defaults={defaults} overrides={overrides} onOverridesChange={onOverridesChange} />;
}

function ParamsForm({
  defaults,
  overrides,
  onOverridesChange,
}: {
  defaults: KnowledgeDefaults;
  overrides: KnowledgeOverrides;
  onOverridesChange: (next: KnowledgeOverrides) => void;
}) {
  const { t } = useTranslation();
  const overrideCount = countOverrides(overrides);

  function commit<K extends keyof KnowledgeOverrides>(key: K, value: NonNullable<KnowledgeOverrides[K]>) {
    const next: KnowledgeOverrides = { ...overrides };
    if (value === defaults[key]) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onOverridesChange(next);
  }

  const effectiveMode: KnowledgeRetrievalMode = overrides.retrievalMode ?? defaults.retrievalMode;
  const effectiveRewrite = overrides.rewriteEnabled ?? defaults.rewriteEnabled;
  const effectiveTopK = overrides.topK ?? defaults.topK;
  const effectivePool = overrides.candidatePool ?? defaults.candidatePool;

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-xs text-muted-foreground">{t('messageInput.knowledgeParamsHint')}</div>
        <button
          type="button"
          onClick={() => onOverridesChange({})}
          disabled={overrideCount === 0}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
            overrideCount > 0
              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300'
              : 'border border-border text-muted-foreground/60 cursor-not-allowed',
          )}
        >
          {t('messageInput.knowledgeRestoreDefaults')}
          {overrideCount > 0 && <span className="font-medium">({overrideCount})</span>}
        </button>
      </div>

      <div className="space-y-4 p-3">
        <ParamRow label={t('messageInput.knowledgeRetrievalMode')} isOverridden={overrides.retrievalMode !== undefined}>
          <div className="grid grid-cols-2 gap-2">
            {(['reference', 'enhanced'] as const).map((value) => (
              <ModeButton
                key={value}
                label={value === 'reference'
                  ? t('messageInput.knowledgeModeReference')
                  : t('messageInput.knowledgeModeEnhanced')}
                active={effectiveMode === value}
                isOverride={overrides.retrievalMode === value}
                isDefault={defaults.retrievalMode === value}
                onClick={() => commit('retrievalMode', value)}
              />
            ))}
          </div>
        </ParamRow>

        <ParamRow label={t('messageInput.knowledgeRewrite')} isOverridden={overrides.rewriteEnabled !== undefined}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-muted-foreground">
              {t('messageInput.knowledgeRewriteHint')} · {t('messageInput.knowledgeDefault')}:{' '}
              {defaults.rewriteEnabled ? t('messageInput.knowledgeOn') : t('messageInput.knowledgeOff')}
            </div>
            <RewriteSwitch
              enabled={effectiveRewrite}
              isOverride={overrides.rewriteEnabled !== undefined}
              onToggle={() => commit('rewriteEnabled', !effectiveRewrite)}
            />
          </div>
        </ParamRow>

        <ParamRow label={t('messageInput.knowledgeTopK')} isOverridden={overrides.topK !== undefined}>
          <ChipRow
            options={TOP_K_OPTIONS}
            active={effectiveTopK}
            override={overrides.topK}
            defaultValue={defaults.topK}
            onPick={(v) => commit('topK', v)}
          />
        </ParamRow>

        <ParamRow label={t('messageInput.knowledgeCandidatePool')} isOverridden={overrides.candidatePool !== undefined}>
          <ChipRow
            options={CANDIDATE_POOL_OPTIONS}
            active={effectivePool}
            override={overrides.candidatePool}
            defaultValue={defaults.candidatePool}
            onPick={(v) => commit('candidatePool', v)}
          />
        </ParamRow>
      </div>
    </div>
  );
}

function countOverrides(overrides: KnowledgeOverrides): number {
  return (Object.keys(overrides) as Array<keyof KnowledgeOverrides>)
    .filter((k) => overrides[k] !== undefined).length;
}

/**
 * Returns a new object with overrides that match the defaults stripped out.
 * Returns the same reference if nothing changed (so callers can `if (next !== overrides)` skip re-renders).
 */
function pruneStaleOverrides(
  overrides: KnowledgeOverrides,
  defaults: KnowledgeDefaults,
): KnowledgeOverrides {
  const next: KnowledgeOverrides = { ...overrides };
  let mutated = false;
  if (next.retrievalMode !== undefined && next.retrievalMode === defaults.retrievalMode) {
    delete next.retrievalMode;
    mutated = true;
  }
  if (next.rewriteEnabled !== undefined && next.rewriteEnabled === defaults.rewriteEnabled) {
    delete next.rewriteEnabled;
    mutated = true;
  }
  if (next.topK !== undefined && next.topK === defaults.topK) {
    delete next.topK;
    mutated = true;
  }
  if (next.candidatePool !== undefined && next.candidatePool === defaults.candidatePool) {
    delete next.candidatePool;
    mutated = true;
  }
  return mutated ? next : overrides;
}
