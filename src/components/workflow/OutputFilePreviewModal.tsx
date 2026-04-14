'use client';

import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { streamdownCode } from '@/lib/streamdown-code';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const plugins = { cjk, code: streamdownCode, math, mermaid };

export interface PreviewableFile {
  name: string;
  content: string;
  sizeBytes: number;
  filePath: string;
  mimeType?: string;
}

interface Props {
  file: PreviewableFile | null;
  onClose: () => void;
}

function buildRawFileUrl(filePath: string): string {
  return `/api/files/raw?path=${encodeURIComponent(filePath)}`;
}

async function openLocalFile(filePath: string): Promise<void> {
  await fetch('/api/files/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function humanFileName(raw: string): string {
  const m = raw.match(/^[0-9a-f-]+?_[A-Za-z0-9_-]+?_(.+)$/);
  return m?.[1] || raw;
}

function isTextLikeMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return true;
  return mimeType.startsWith('text/') || mimeType === 'application/json';
}

export function OutputFilePreviewModal({ file, onClose }: Props) {
  const open = Boolean(file);
  const displayName = file ? humanFileName(file.name) : '';
  const isImage = file?.mimeType?.startsWith('image/');
  const isText = file ? isTextLikeMimeType(file.mimeType) : false;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2 flex-wrap">
            <span className="truncate">{displayName}</span>
            {file && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                {formatBytes(file.sizeBytes)}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {file && (
          <>
            <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-border/40">
              <button
                type="button"
                onClick={() => { void openLocalFile(file.filePath); }}
                className="inline-flex rounded-md border border-border/60 px-3 py-1 text-xs font-medium hover:bg-muted/40 transition-colors"
              >
                打开本地文件
              </button>
              <a
                href={buildRawFileUrl(file.filePath)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-md border border-border/60 px-3 py-1 text-xs font-medium hover:bg-muted/40 transition-colors"
              >
                下载原文件
              </a>
              <span className="text-xs text-muted-foreground font-mono truncate max-w-[300px]" title={file.filePath}>
                {file.filePath}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto pt-2">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:${file.mimeType};base64,${file.content}`}
                  alt={displayName}
                  className="max-w-full rounded mx-auto"
                />
              ) : isText && file.content ? (
                <Streamdown
                  className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 leading-relaxed"
                  plugins={plugins}
                >
                  {file.content}
                </Streamdown>
              ) : isText ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  文件为空
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-sm text-muted-foreground text-center">
                  当前文件类型暂不支持内联预览，请使用上方按钮打开或下载。
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
