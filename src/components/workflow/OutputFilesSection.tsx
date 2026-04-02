'use client';

import { memo, useState } from 'react';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { streamdownCode } from '@/lib/streamdown-code';
import { Badge } from '@/components/ui/badge';

const plugins = { cjk, code: streamdownCode, math, mermaid };

interface OutputFile {
  name: string;
  stepId: string;
  agentName: string;
  content: string;
  sizeBytes: number;
  mimeType?: string;
  createdAt?: string;
}

function formatFileTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function humanFileName(raw: string): string {
  // Strip runId prefix: "98c49260-..._crawl-ai-content_AI资讯文章汇总.md" → "AI资讯文章汇总.md"
  // Pattern: {uuid}_{stepId}_{rest}
  const m = raw.match(/^[0-9a-f-]+?_[A-Za-z0-9_-]+?_(.+)$/);
  return m?.[1] || raw;
}

const FileCard = memo(({ file, defaultOpen }: { file: OutputFile; defaultOpen: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);
  const displayName = humanFileName(file.name);

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full px-5 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex flex-col items-start gap-0.5 min-w-0">
          <span className="text-sm font-medium truncate w-full">{displayName}</span>
          <span className="text-xs text-muted-foreground">{file.agentName}</span>
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {file.createdAt && <span className="text-[10px] text-muted-foreground">{formatFileTime(file.createdAt)}</span>}
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
            {formatBytes(file.sizeBytes)}
          </Badge>
          <span className="text-xs text-muted-foreground">{open ? '收起' : '展开'}</span>
        </div>
      </button>

      {open && (
        <div className="px-5 py-4 border-t border-border/40">
          {file.mimeType?.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:${file.mimeType};base64,${file.content}`}
              alt={displayName}
              className="max-w-full rounded"
            />
          ) : (
            <Streamdown
              className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 leading-relaxed"
              plugins={plugins}
            >
              {file.content}
            </Streamdown>
          )}
        </div>
      )}
    </div>
  );
});
FileCard.displayName = 'FileCard';

export function OutputFilesSection({ files }: { files: OutputFile[] }) {
  if (files.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground rounded-xl border border-dashed border-border/50">
        暂无结果文件
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {files.map((f, i) => (
        <FileCard key={`${f.stepId}/${f.name}`} file={f} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
