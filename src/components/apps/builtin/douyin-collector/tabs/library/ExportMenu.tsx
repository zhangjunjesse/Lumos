'use client';

import * as React from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { LibraryStatusFilter } from '../../use-videos';

interface ExportFormat {
  format: 'markdown' | 'json' | 'anki' | 'csv';
  label: string;
  hint: string;
}

const EXPORT_FORMATS: ExportFormat[] = [
  { format: 'markdown', label: 'Markdown (.md)', hint: 'Notion / Obsidian 通用 — 含字幕原文' },
  { format: 'json', label: 'JSON (.json)', hint: '结构化备份；含字幕原文（程序可读）' },
  { format: 'anki', label: 'Anki TSV (.txt)', hint: '间隔重复闪卡 — 需要已整理摘要' },
  { format: 'csv', label: 'CSV (.csv)', hint: 'Excel / Numbers / Sheets / Notion DB' },
];

/**
 * Single dropdown trigger replacing 4 separate export buttons. Each item
 * shows the format + a one-line hint so users can pick the right one
 * without going to docs.
 *
 * Filter awareness: when any filter is active, export restricts to
 * currently visible row ids (capped at 200 to stay under URL-length
 * limits). Mirrors the Round 159 fix for bulk-publish.
 *
 * Extracted from LibraryTab in round 7. No behaviour change.
 */
export function ExportMenu({
  status,
  filterActive,
  visibleIds,
}: {
  status: LibraryStatusFilter;
  filterActive: boolean;
  visibleIds: string[];
}): React.ReactElement {
  const scope =
    status === 'published'
      ? 'published'
      : status === 'unprocessed' || status === 'draft'
        ? 'draft'
        : 'all';
  const idsParam =
    filterActive && visibleIds.length > 0
      ? `&ids=${encodeURIComponent(visibleIds.slice(0, 200).join(','))}`
      : '';
  const rangeLabel = filterActive
    ? `当前筛选可见（${Math.min(visibleIds.length, 200)} 条）`
    : scope === 'published' ? '已入库' : scope === 'draft' ? '草稿+待整理' : '全部';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="size-3.5" />
          导出{filterActive ? `（${Math.min(visibleIds.length, 200)}）` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          范围：{rangeLabel}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {EXPORT_FORMATS.map((f) => (
          <DropdownMenuItem key={f.format} asChild>
            <a
              href={
                f.format === 'markdown'
                  ? `/api/apps/builtin/douyin-collector/videos/export?scope=${scope}${idsParam}`
                  : `/api/apps/builtin/douyin-collector/videos/export?format=${f.format}&scope=${scope}${idsParam}`
              }
              download
              className="flex flex-col items-start gap-0.5"
            >
              <span className="text-sm">{f.label}</span>
              <span className="text-[10px] text-muted-foreground">{f.hint}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
