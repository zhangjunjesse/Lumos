'use client';

import { useState } from 'react';
import { getFileCategory, type FileCategory } from '@/lib/file-categories';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { streamdownCode } from '@/lib/streamdown-code';
import { LibraryPreviewDialog } from './library-preview-dialog';

const plugins = { cjk, code: streamdownCode, math };

const MAX_INLINE_CHARS = 600;

export interface PreviewableItem {
  sourceType?: string;
  path: string;
  title: string;
  type: string;
}

interface LibraryContentPreviewProps {
  item: PreviewableItem;
  textContent: string;
}

function getItemFileCategory(item: PreviewableItem): FileCategory | null {
  if (item.sourceType === 'local_file' && item.path) {
    return getFileCategory(item.path);
  }
  return null;
}

function hasRichPreview(category: FileCategory | null): boolean {
  return !!category && category !== 'text';
}

export function LibraryContentPreview({ item, textContent }: LibraryContentPreviewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const category = getItemFileCategory(item);
  const isRich = hasRichPreview(category);
  const isTruncated = textContent.length > MAX_INLINE_CHARS;
  const inlineText = isTruncated ? textContent.slice(0, MAX_INLINE_CHARS) + '…' : textContent;
  const showButton = isRich || isTruncated;

  if (!textContent && !isRich) {
    return <p className="text-sm text-muted-foreground">暂无预览</p>;
  }

  return (
    <>
      {/* Compact inline preview */}
      {isRich ? (
        <RichPreviewHint category={category!} filePath={item.path} />
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-base prose-p:leading-relaxed prose-pre:text-xs">
          <Streamdown
            className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-6 [&_ol]:pl-6"
            plugins={plugins}
          >
            {inlineText}
          </Streamdown>
        </div>
      )}

      {showButton && (
        <button
          onClick={() => setDialogOpen(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          查看原文
        </button>
      )}

      <LibraryPreviewDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={item}
        textContent={textContent}
        fileCategory={category}
      />
    </>
  );
}

function RichPreviewHint({ category, filePath }: { category: FileCategory; filePath: string }) {
  const fileName = filePath.split('/').pop() || filePath;
  const labels: Record<string, string> = {
    image: '图片文件',
    pdf: 'PDF 文档',
    word: 'Word 文档',
    excel: 'Excel 表格',
    powerpoint: 'PowerPoint 演示',
    video: '视频文件',
    audio: '音频文件',
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-3">
      <FileIcon category={category} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fileName}</p>
        <p className="text-xs text-muted-foreground">{labels[category] || '文件'} — 点击「查看原文」预览完整内容</p>
      </div>
    </div>
  );
}

function FileIcon({ category }: { category: FileCategory }) {
  const colors: Record<string, string> = {
    image: 'text-emerald-500',
    pdf: 'text-red-500',
    word: 'text-blue-500',
    excel: 'text-green-600',
    powerpoint: 'text-orange-500',
    video: 'text-purple-500',
    audio: 'text-pink-500',
  };
  return (
    <svg className={`h-8 w-8 shrink-0 ${colors[category] || 'text-muted-foreground'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}
