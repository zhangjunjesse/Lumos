'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { FileCategory } from '@/lib/file-categories';
import { ImagePreview } from '@/components/preview/ImagePreview';
import { VideoPreview } from '@/components/preview/VideoPreview';
import { AudioPreview } from '@/components/preview/AudioPreview';
import { PdfPreview } from '@/components/preview/PdfPreview';
import { WordPreview } from '@/components/preview/WordPreview';
import { ExcelPreview } from '@/components/preview/ExcelPreview';
import { PowerPointPreview } from '@/components/preview/PowerPointPreview';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { streamdownCode } from '@/lib/streamdown-code';
import type { PreviewableItem } from './library-content-preview';

const plugins = { cjk, code: streamdownCode, math };

interface LibraryPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PreviewableItem;
  textContent: string;
  fileCategory: FileCategory | null;
}

export function LibraryPreviewDialog({
  open,
  onOpenChange,
  item,
  textContent,
  fileCategory,
}: LibraryPreviewDialogProps) {
  const fileName = item.path ? item.path.split('/').pop() || item.title : item.title;
  const isRich = !!fileCategory && fileCategory !== 'text';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        showCloseButton
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="truncate text-base">{fileName}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {item.type}{item.path ? ` · ${item.path}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto">
          {isRich ? (
            <RichFilePreview filePath={item.path} category={fileCategory!} />
          ) : textContent ? (
            <div className="px-6 py-5 prose prose-sm dark:prose-invert max-w-none prose-headings:text-base prose-p:leading-relaxed prose-pre:text-xs">
              <Streamdown
                className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-6 [&_ol]:pl-6"
                plugins={plugins}
              >
                {textContent}
              </Streamdown>
            </div>
          ) : (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              暂无内容
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RichFilePreview({ filePath, category }: { filePath: string; category: FileCategory }) {
  switch (category) {
    case 'image':
      return (
        <div className="flex items-center justify-center p-6">
          <ImagePreview filePath={filePath} />
        </div>
      );
    case 'pdf':
      return (
        <div className="h-full">
          <PdfPreview filePath={filePath} />
        </div>
      );
    case 'word':
      return (
        <div className="h-full">
          <WordPreview filePath={filePath} />
        </div>
      );
    case 'excel':
      return (
        <div className="h-full">
          <ExcelPreview filePath={filePath} />
        </div>
      );
    case 'powerpoint':
      return (
        <div className="h-full">
          <PowerPointPreview filePath={filePath} />
        </div>
      );
    case 'video':
      return (
        <div className="p-6">
          <VideoPreview filePath={filePath} />
        </div>
      );
    case 'audio':
      return (
        <div className="p-6">
          <AudioPreview filePath={filePath} />
        </div>
      );
    default:
      return null;
  }
}
