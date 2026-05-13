'use client';

import * as React from 'react';
import { Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

import {
  bulkPublish,
  bulkSetStatus,
  bulkTranscribe,
  useVideos,
  type LibraryBacklogChip,
  type LibraryStatusFilter,
  type LibrarySort,
  type SearchScope,
} from '../use-videos';
import { useLibraryBacklog } from '../use-library-backlog';
import { BacklogChips } from '../components/BacklogChips';
import { VideoCard } from '../components/VideoCard';
import { BulkStatusBar } from './library/BulkStatusBar';
import { BulkStatusDialog } from './library/BulkStatusDialog';
import { ExportMenu } from './library/ExportMenu';
import { LibraryActiveChips } from './library/LibraryActiveChips';
import { LibraryEmptyState } from './library/LibraryEmptyState';
import { LibraryFilters } from './library/LibraryFilters';
import { LibraryToolbar } from './library/LibraryToolbar';
import { useLibraryBulkActions } from './library/use-library-bulk-actions';
import { useLibrarySearchShortcut } from './library/use-library-shortcuts';
import { useLibraryViewPersistence } from './library/use-library-view-persistence';
import { countActiveFilters } from '@/lib/douyin-collector/library-filter-helpers';
import {
  DEFAULT_VIEW,
  deserializeView,
  isMeaningfulView,
} from '@/lib/douyin-collector/library-view-storage';

const VIEW_STORAGE_KEY = 'lumos:douyin-collector:library-view';

export function LibraryTab({
  initialTag,
  onConsumedInitialTag,
  initialBacklog,
  onConsumedInitialBacklog,
  initialCreator,
  onConsumedInitialCreator,
}: {
  initialTag?: string | null;
  onConsumedInitialTag?: () => void;
  initialBacklog?: LibraryBacklogChip | null;
  onConsumedInitialBacklog?: () => void;
  initialCreator?: { ref: string; label: string } | null;
  onConsumedInitialCreator?: () => void;
} = {}): React.ReactElement {
  // Lazy init from localStorage so users land on their last filter view.
  // 'use client' guarantees window is defined; the try/catch + DEFAULT_VIEW
  // fallback keeps a corrupt or missing storage entry from breaking mount.
  const initial = React.useMemo(() => {
    if (typeof window === 'undefined') return DEFAULT_VIEW;
    try {
      return deserializeView(window.localStorage.getItem(VIEW_STORAGE_KEY));
    } catch {
      return DEFAULT_VIEW;
    }
  }, []);

  const [status, setStatus] = React.useState<LibraryStatusFilter>(initial.status);
  const [search, setSearch] = React.useState(initial.search);
  const [searchInput, setSearchInput] = React.useState(initial.search);
  const [sort, setSort] = React.useState<LibrarySort>(initial.sort);
  const [tag, setTag] = React.useState(initial.tag);
  const [backlog, setBacklog] = React.useState<LibraryBacklogChip | null>(initial.backlog);
  const [searchScope, setSearchScope] = React.useState<SearchScope>(initial.searchScope);
  const [creatorRef, setCreatorRef] = React.useState(initial.creatorRef);
  const [creatorLabel, setCreatorLabel] = React.useState(initial.creatorLabel);
  // Show a "已恢复上次筛选" pill when the lazy init hydrated a meaningful
  // (non-default) view. Clicking dismiss / 重置全部 clears it.
  const [restoredHint, setRestoredHint] = React.useState(() => isMeaningfulView(initial));
  const [bulkStatusOpen, setBulkStatusOpen] = React.useState<'discard' | 'restore' | null>(null);
  const [bulkStatusBusy, setBulkStatusBusy] = React.useState(false);
  // Filter awareness: bulk-publish should respect current view. Without
  // this, "批量入库" from a "tag=Tesla" filter publishes ALL drafts
  // globally — confusing. See Round 159.
  const filterActive =
    status !== 'all' ||
    search.trim().length > 0 ||
    tag.trim().length > 0 ||
    backlog !== null ||
    creatorRef.trim().length > 0;
  // Bumped after every mutation so backlog counts re-fetch.
  const [refreshTick, setRefreshTick] = React.useState(0);
  const { counts: backlogCounts, statusCounts } = useLibraryBacklog(refreshTick);

  // External callers (e.g. HotTagsPanel via DouyinCollectorApp) can request
  // a tag filter when switching to this tab. We absorb the request once and
  // then notify so the parent can clear its pending state — second arrival
  // of the same value is therefore picked up.
  React.useEffect(() => {
    if (typeof initialTag === 'string' && initialTag.length > 0) {
      setTag(initialTag);
      onConsumedInitialTag?.();
    }
  }, [initialTag, onConsumedInitialTag]);
  React.useEffect(() => {
    if (initialBacklog) {
      setBacklog(initialBacklog);
      // Clearing other filters that would narrow the backlog set further
      // is dangerous (user may want to combine). We only set the chip;
      // user can clear it via second click.
      onConsumedInitialBacklog?.();
    }
  }, [initialBacklog, onConsumedInitialBacklog]);
  React.useEffect(() => {
    if (initialCreator && initialCreator.ref) {
      setCreatorRef(initialCreator.ref);
      setCreatorLabel(initialCreator.label);
      onConsumedInitialCreator?.();
    }
  }, [initialCreator, onConsumedInitialCreator]);
  const { videos, loading, error, refresh: refreshVideos } = useVideos({
    status,
    search,
    sort,
    tag,
    backlog,
    searchScope,
    creatorRef,
  });
  const refresh = React.useCallback(async () => {
    await refreshVideos();
    setRefreshTick((n) => n + 1);
  }, [refreshVideos]);

  // Round 15: bulk state machine + Round 157 contract wrapper extracted
  // into a hook so LibraryTab itself stops carrying 30+ lines of bulk
  // bookkeeping inline.
  const { bulkBusy, bulkFeedback, setBulkFeedback, runBulk } =
    useLibraryBulkActions(refresh);
  // Subset of currently-visible videos that bulk-publish would actually
  // accept: have a transcript, not discarded, and either are not in the
  // current knowledge collection yet, need index repair, or need global
  // library summary/key-point enhancement repair. Used by the bulk publish
  // button to scope its action to the user's view.
  const eligiblePublishIds = React.useMemo(
    () =>
      videos
        .filter(
          (v) =>
            v.transcript_status === 'success' &&
            v.library_status !== 'discarded' &&
            (!v.library_published_to_current ||
              v.library_current_index_ready !== true ||
              v.library_current_needs_enhancement === true),
        )
        .map((v) => v.id),
    [videos],
  );
  // Round 178: ids of all currently-visible videos (broader than
  // eligiblePublishIds — export should respect the filter regardless
  // of transcribe state; user might want metadata-only export).
  const visibleIds = React.useMemo(() => videos.map((v) => v.id), [videos]);

  // Single source of truth for "reset all filters" — used by the header
  // button (Round 93) and the empty-state CTA (Round 124). sort is a
  // preference, not a filter, so it's intentionally NOT reset.
  const clearAllFilters = React.useCallback(() => {
    setStatus('all');
    setSearch('');
    setSearchInput('');
    setTag('');
    setBacklog(null);
    setCreatorRef('');
    setCreatorLabel('');
    setSearchScope('metadata');
    setRestoredHint(false);
  }, []);

  React.useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 200);
    return () => clearTimeout(id);
  }, [searchInput]);

  const searchInputRef = React.useRef<HTMLInputElement>(null);
  useLibrarySearchShortcut(searchInputRef, searchInput, setSearchInput);
  useLibraryViewPersistence(VIEW_STORAGE_KEY, {
    status,
    search,
    tag,
    sort,
    backlog,
    searchScope,
    creatorRef,
    creatorLabel,
  });

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">资料库</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            已采集视频；先抓字幕，再入知识库。卡片摘要来自入库后的资料库索引概述。
          </p>
        </div>
        <LibraryToolbar
          bulkBusy={bulkBusy}
          eligiblePublishCount={eligiblePublishIds.length}
          filterActive={filterActive}
          visibleIds={visibleIds}
          status={status}
          loading={loading}
          onBulkTranscribe={() =>
            void runBulk('transcribe', '批量抓字幕', () =>
              bulkTranscribe({ scope: 'pending', limit: 20 }),
            )
          }
          onBulkRetry={() =>
            void runBulk('retry', '重跑失败转写', () =>
              bulkTranscribe({ scope: 'failed', limit: 20 }),
            )
          }
          onBulkPublish={() => {
            // Honor the current filter: filterless publish uses scope='draft'
            // (server-side capped at 30); filtered publish restricts to the
            // visible-and-eligible subset so a "tag=Tesla" view doesn't
            // surprise-publish unrelated drafts.
            if (filterActive) {
              if (eligiblePublishIds.length === 0) {
                setBulkFeedback({
                  kind: 'error',
                  text: '当前筛选下没有可入库、需补索引或需补概述/要点的视频（需有字幕、未丢弃）。',
                });
                return;
              }
              void runBulk('publish', '批量入库/补资料库', () =>
                bulkPublish({ ids: eligiblePublishIds }),
              );
            } else {
              void runBulk('publish', '批量入库/补资料库', () =>
                bulkPublish({ scope: 'draft', limit: 30 }),
              );
            }
          }}
          onRefresh={() => void refresh()}
        />
      </header>

      <LibraryFilters
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        searchInputRef={searchInputRef}
        searchScope={searchScope}
        onSearchScopeToggle={() =>
          setSearchScope((prev) => (prev === 'transcript' ? 'metadata' : 'transcript'))
        }
        sort={sort}
        onSortChange={setSort}
        status={status}
        onStatusChange={setStatus}
        search={search}
        tag={tag}
        backlog={backlog}
        creatorRef={creatorRef}
        statusCounts={statusCounts}
        onClearAll={clearAllFilters}
      />

      <BacklogChips counts={backlogCounts} active={backlog} onChange={setBacklog} />

      {restoredHint ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>已恢复上次的筛选</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={() => setRestoredHint(false)}
          >
            知道了
          </Button>
        </div>
      ) : null}

      <LibraryActiveChips
        tag={tag}
        creatorRef={creatorRef}
        creatorLabel={creatorLabel}
        onClearTag={() => setTag('')}
        onClearCreator={() => {
          setCreatorRef('');
          setCreatorLabel('');
        }}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {bulkFeedback ? (
        <Alert variant={bulkFeedback.kind === 'ok' ? 'default' : 'destructive'}>
          <AlertDescription>{bulkFeedback.text}</AlertDescription>
        </Alert>
      ) : null}

      {videos.length > 0 ? (
        <BulkStatusBar
          status={status}
          backlog={backlog}
          videoCount={videos.length}
          busy={bulkStatusBusy}
          onAsk={(kind) => setBulkStatusOpen(kind)}
        />
      ) : null}

      <BulkStatusDialog
        kind={bulkStatusOpen}
        videoCount={videos.length}
        busy={bulkStatusBusy}
        onCancel={() => setBulkStatusOpen(null)}
        onConfirm={async () => {
          setBulkStatusBusy(true);
          const target = bulkStatusOpen === 'restore' ? 'unprocessed' : 'discarded';
          const ids = videos.map((v) => v.id);
          const r = await bulkSetStatus(ids, target);
          setBulkStatusBusy(false);
          const wasRestore = bulkStatusOpen === 'restore';
          setBulkStatusOpen(null);
          if (r.ok) {
            // Surface skipped count when present — most likely cause is
            // concurrent deletion (the user's selection got stale before
            // the click). Without this, "已丢弃 45 条" hides the 5
            // missing rows and the user wonders where they went.
            const skippedSuffix =
              (r.skipped ?? 0) > 0 ? `（${r.skipped} 条已不存在，跳过）` : '';
            setBulkFeedback({
              kind: 'ok',
              text: wasRestore
                ? `已恢复 ${r.updated ?? 0} 条${skippedSuffix}`
                : `已丢弃 ${r.updated ?? 0} 条${skippedSuffix}`,
            });
          } else {
            setBulkFeedback({ kind: 'error', text: r.error ?? '操作失败' });
          }
          await refresh();
        }}
      />

      {loading && videos.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          加载中…
        </div>
      ) : videos.length === 0 ? (
        <LibraryEmptyState
          activeFilterCount={countActiveFilters({
            status,
            search,
            tag,
            backlog,
            creatorRef,
            searchScope,
          })}
          onClearAll={clearAllFilters}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              onChanged={refresh}
              onTagClick={(t) => setTag(t)}
              onCreatorClick={(ref, label) => {
                setCreatorRef(ref);
                setCreatorLabel(label);
              }}
              highlightQuery={searchScope === 'transcript' ? search : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
