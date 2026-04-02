'use client';

import { useState, useCallback, useEffect } from 'react';
import { unwrapToolResult } from '@/lib/tool-result-parser';
import { ChevronDown, ChevronRight, Globe, ExternalLink, BookMarked, Check, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Site icon map
// ---------------------------------------------------------------------------

const SITE_ICONS: Record<string, { label: string; color: string; icon: string }> = {
  zhihu: { label: '知乎', color: '#0066FF', icon: 'https://static.zhihu.com/heifetz/favicon.ico' },
  wechat: { label: '微信公众号', color: '#07C160', icon: 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico' },
  xiaohongshu: { label: '小红书', color: '#FF2442', icon: 'https://www.xiaohongshu.com/favicon.ico' },
  juejin: { label: '掘金', color: '#1E80FF', icon: 'https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png' },
  x: { label: 'X / Twitter', color: '#000000', icon: 'https://abs.twimg.com/favicons/twitter.3.ico' },
};

function getSiteInfo(siteKey: string | null) {
  if (siteKey && SITE_ICONS[siteKey]) return SITE_ICONS[siteKey];
  return { label: siteKey || '网页', color: '#6B7280', icon: '' };
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeepSearchSource {
  url: string;
  title: string;
  siteKey: string | null;
  contentState: string;
  snippet?: string;
}

interface DeepSearchSourcesCardProps {
  sources: DeepSearchSource[];
  query?: string;
  runId?: string;
  archivePrompt?: boolean;
}

// ---------------------------------------------------------------------------
// Archive status type
// ---------------------------------------------------------------------------

type ArchiveUiState = 'prompt' | 'saving' | 'saved' | 'idle';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeepSearchSourcesCard({ sources, query, runId, archivePrompt }: DeepSearchSourcesCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Initialize as 'idle' to avoid SSR hydration mismatch (localStorage unavailable on server).
  // Sync from localStorage after mount.
  const [archiveState, setArchiveState] = useState<ArchiveUiState>('idle');

  useEffect(() => {
    if (!runId) return;
    if (lsGet(`ds:saved:${runId}`)) {
      setArchiveState('saved');
    } else if (!lsGet(`ds:dismissed:${runId}`) && archivePrompt) {
      setArchiveState('prompt');
    }
  }, [runId, archivePrompt]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!runId) return;
    setArchiveState('saving');
    setArchiveError(null);
    try {
      const res = await fetch(`/api/deepsearch/runs/${runId}/save-to-library`, { method: 'POST' });
      const data = await res.json() as { saved?: number; eligible?: number; error?: string };
      if (!res.ok) throw new Error(data.error || '保存失败');
      const count = typeof data.saved === 'number' ? data.saved : (data.eligible ?? 0);
      setSavedCount(count);
      setArchiveState('saved');
      if (runId) lsSet(`ds:saved:${runId}`, '1');
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : '保存失败');
      setArchiveState('prompt');
    }
  }, [runId]);

  const handleDismiss = useCallback(() => {
    if (runId) lsSet(`ds:dismissed:${runId}`, '1');
    setArchiveState('idle');
  }, [runId]);

  const handleResave = useCallback(() => {
    if (runId) {
      try { localStorage.removeItem(`ds:saved:${runId}`); } catch { /* ignore */ }
    }
    setSavedCount(null);
    void handleSave();
  }, [runId, handleSave]);

  if (sources.length === 0) return null;

  // Group by siteKey for the icon strip
  const siteKeys = [...new Set(sources.map((s) => s.siteKey || '__generic__'))];
  // Filter to content records (skip list_only and failed)
  const contentSources = sources.filter((s) => s.contentState !== 'list_only' && s.contentState !== 'failed');
  const displaySources = expanded ? contentSources : contentSources.slice(0, 4);

  return (
    <div className="my-2 rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
      {/* Header strip */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1">
          {siteKeys.map((key) => {
            const info = getSiteInfo(key === '__generic__' ? null : key);
            return info.icon ? (
              <img
                key={key}
                src={info.icon}
                alt={info.label}
                className="h-4 w-4 rounded-sm"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <Globe key={key} className="h-4 w-4" />
            );
          })}
        </div>
        <span className="font-medium">
          {contentSources.length} 个来源
          {query ? ` · ${query}` : ''}
        </span>
        <span className="ml-auto">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/* Source pills (always visible) */}
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        {displaySources.map((source, i) => {
          const info = getSiteInfo(source.siteKey);
          return (
            <a
              key={`${source.url}-${i}`}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-1.5 rounded-md border border-border/50 bg-background px-2 py-1 text-xs hover:border-border hover:shadow-sm transition-all max-w-[280px]"
              title={source.title || source.url}
            >
              {info.icon ? (
                <img
                  src={info.icon}
                  alt={info.label}
                  className="h-3.5 w-3.5 rounded-sm flex-shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).replaceWith(document.createElement('span')); }}
                />
              ) : (
                <Globe className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              )}
              <span className="truncate text-foreground/80 group-hover:text-foreground">
                {source.title || getDomain(source.url)}
              </span>
              <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
            </a>
          );
        })}
        {!expanded && contentSources.length > 4 && (
          <button
            type="button"
            className="rounded-md border border-border/50 bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded(true)}
          >
            +{contentSources.length - 4} 更多
          </button>
        )}
      </div>

      {/* Archive action area */}
      <ArchiveBar
        archiveState={archiveState}
        savedCount={savedCount}
        archiveError={archiveError}
        runId={runId}
        onSave={handleSave}
        onDismiss={handleDismiss}
        onResave={handleResave}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArchiveBar sub-component
// ---------------------------------------------------------------------------

interface ArchiveBarProps {
  archiveState: ArchiveUiState;
  savedCount: number | null;
  archiveError: string | null;
  runId?: string;
  onSave: () => void;
  onDismiss: () => void;
  onResave: () => void;
}

function ArchiveBar({ archiveState, savedCount, archiveError, runId, onSave, onDismiss, onResave }: ArchiveBarProps) {
  if (!runId) return null;

  if (archiveState === 'prompt') {
    return (
      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-3 py-2 text-xs">
        <span className="text-muted-foreground">搜索已完成，是否保存到「联网搜索资料」？</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onSave}
            className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            保存
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            跳过
          </button>
        </div>
      </div>
    );
  }

  if (archiveState === 'saving') {
    return (
      <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>正在保存到知识库…</span>
      </div>
    );
  }

  if (archiveState === 'saved') {
    return (
      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-green-500" />
          <span>
            已保存 {savedCount !== null ? `${savedCount} 条` : ''}到「联网搜索资料」
          </span>
        </div>
        <button
          type="button"
          onClick={onResave}
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors shrink-0"
        >
          重新保存
        </button>
      </div>
    );
  }

  // idle — show manual save button only
  return (
    <div className="flex items-center gap-1.5 border-t border-border/40 px-3 py-2">
      {archiveError && (
        <span className="text-xs text-rose-500 mr-1">{archiveError}</span>
      )}
      <button
        type="button"
        onClick={onSave}
        className="flex items-center gap-1.5 rounded-md border border-border/50 bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-all"
      >
        <BookMarked className="h-3.5 w-3.5" />
        保存到资料库
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parser: extract DeepSearch sources from tool results
// ---------------------------------------------------------------------------

export function extractDeepSearchSources(
  pairedTools: Array<{ name: string; result?: string; isError?: boolean }>,
): { sources: DeepSearchSource[]; query: string; runId?: string; archivePrompt?: boolean } | null {
  // Use the LAST deepsearch result (get_result has the complete data)
  let best: { sources: DeepSearchSource[]; query: string; runId?: string; archivePrompt?: boolean } | null = null;

  for (const tool of pairedTools) {
    if (!tool.name.includes('deepsearch') || !tool.result || tool.isError) continue;
    try {
      const data = unwrapToolResult(tool.result);
      const records = data?.sampleRecords as Array<{
        url?: string;
        title?: string;
        siteKey?: string;
        contentState?: string;
        snippet?: string;
      }> | undefined;
      if (!records || records.length === 0) continue;

      best = {
        query: typeof data?.query === 'string' ? data.query : '',
        runId: typeof data?.runId === 'string' ? data.runId : undefined,
        archivePrompt: data?.archivePrompt === true,
        sources: records.map((r) => ({
          url: r.url || '',
          title: r.title || '',
          siteKey: r.siteKey || null,
          contentState: r.contentState || 'unknown',
          snippet: r.snippet,
        })).filter((s) => s.url),
      };
    } catch {
      continue;
    }
  }
  return best;
}
