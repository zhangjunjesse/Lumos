'use client';

import * as React from 'react';
import { FileText, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { countActiveFilters } from '@/lib/douyin-collector/library-filter-helpers';
import type { LibraryStatusCountsClient } from '../../use-library-backlog';
import type {
  LibraryBacklogChip,
  LibrarySort,
  LibraryStatusFilter,
  SearchScope,
} from '../../use-videos';

const FILTERS: Array<{ value: LibraryStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'unprocessed', label: '待整理' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已入库' },
  { value: 'discarded', label: '丢弃' },
];

const SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'newest', label: '最新' },
  { value: 'oldest', label: '最早' },
  { value: 'longest', label: '最长' },
  { value: 'starred', label: '加星优先' },
  { value: 'curated', label: '完整度优先' },
];

/**
 * Library top-of-list filter row: search + transcript-scope toggle + sort +
 * status chips + reset-all. Pure presentation: parent owns all state and
 * passes setters. Status chip counts come from the same backlog hook the
 * parent uses, so chips and main count stay in sync.
 *
 * Extracted from LibraryTab in round 9.
 */
export function LibraryFilters({
  searchInput,
  onSearchInputChange,
  searchInputRef,
  searchScope,
  onSearchScopeToggle,
  sort,
  onSortChange,
  status,
  onStatusChange,
  search,
  tag,
  backlog,
  creatorRef,
  statusCounts,
  onClearAll,
}: {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchScope: SearchScope;
  onSearchScopeToggle: () => void;
  sort: LibrarySort;
  onSortChange: (value: LibrarySort) => void;
  status: LibraryStatusFilter;
  onStatusChange: (value: LibraryStatusFilter) => void;
  search: string;
  tag: string;
  backlog: LibraryBacklogChip | null;
  creatorRef: string;
  statusCounts: LibraryStatusCountsClient;
  onClearAll: () => void;
}): React.ReactElement {
  const activeCount = countActiveFilters({
    status,
    search,
    tag,
    backlog,
    creatorRef,
    searchScope,
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          placeholder={
            searchScope === 'transcript'
              ? '搜索标题 / 博主 / 备注 / 字幕全文'
              : '搜索标题 / 博主 / 备注'
          }
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          className="pl-8 pr-12"
        />
        {searchInput.length === 0 ? (
          <span
            className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground sm:inline"
            title="按 ⌘K / Ctrl+K 聚焦搜索；Esc 清空"
          >
            ⌘K
          </span>
        ) : null}
      </div>
      <Button
        size="sm"
        variant={searchScope === 'transcript' ? 'default' : 'outline'}
        onClick={onSearchScopeToggle}
        title={
          searchScope === 'transcript'
            ? '关闭：只搜元数据，更快'
            : '打开：把字幕全文也加进来一起搜（用于「找一下提到 XX 的视频」）'
        }
        className="gap-1"
      >
        <FileText className="size-3.5" />
        字幕全文
      </Button>
      <Select value={sort} onValueChange={(v) => onSortChange(v as LibrarySort)}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1">
        {FILTERS.map((f) => {
          const count =
            f.value === 'all'
              ? statusCounts.videos
              : f.value === 'unprocessed'
                ? statusCounts.unprocessed
                : f.value === 'draft'
                  ? statusCounts.drafts
                  : f.value === 'published'
                    ? statusCounts.published
                    : statusCounts.discarded;
          return (
            <Button
              key={f.value}
              size="sm"
              variant={status === f.value ? 'default' : 'ghost'}
              onClick={() => onStatusChange(f.value)}
              className="gap-1.5"
            >
              <span>{f.label}</span>
              {count > 0 ? (
                <span
                  className={
                    status === f.value
                      ? 'rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums'
                      : 'rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground'
                  }
                >
                  {count}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>
      {activeCount >= 2 ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[10px] text-muted-foreground"
          onClick={onClearAll}
          title="清除所有筛选（保留排序方式）"
        >
          <X className="size-3" />
          重置全部 ({activeCount})
        </Button>
      ) : null}
    </div>
  );
}
