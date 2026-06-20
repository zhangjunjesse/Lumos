'use client';

// 提示词弹框:查看某张生成图所用的提示词,可编辑后重生成(新图进图库,原图保留)。
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ListingPhoto } from '@/lib/etsy-forge/listing/types';

interface Props {
  photo: ListingPhoto | null;
  onClose: () => void;
  onRegenerate: (prompt: string, role?: string) => void;
}

export function PromptEditorDialog({ photo, onClose, onRegenerate }: Props) {
  // 父组件用 key={photo.src} 让本组件随图重挂载,故首次即可从 props 初始化(无需 effect 同步)。
  const [prompt, setPrompt] = useState(photo?.prompt ?? '');

  if (!photo) return null;
  const hasPrompt = Boolean(photo.prompt);

  return (
    <Dialog open={Boolean(photo)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>生成提示词</DialogTitle>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.src} alt="" className="max-h-56 w-full rounded border object-contain" />
        {!hasPrompt && (
          <p className="text-xs text-amber-600">
            这张图没有记录提示词(可能是上传/挑选的,或在本功能上线前生成)。你仍可写一段提示词重新生成一张。
          </p>
        )}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="生成这张图所用的提示词。可编辑后点重生成。"
          className="w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={!prompt.trim()} onClick={() => void navigator.clipboard?.writeText(prompt)}>
            复制
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
            <Button disabled={!prompt.trim()} onClick={() => { onRegenerate(prompt.trim(), photo.role); onClose(); }}>
              重新生成(再出一张)
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">重生成以印花作唯一参考 + 上面的提示词,结果作为新图进图库,原图保留。</p>
      </DialogContent>
    </Dialog>
  );
}
