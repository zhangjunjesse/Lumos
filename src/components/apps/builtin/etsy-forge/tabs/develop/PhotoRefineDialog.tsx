'use client';

// 精修弹框:给一张商品图 + 说怎么改 → 再出一张(img2img，作为新图进图库，原图保留)。
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  src: string | null;
  onClose: () => void;
  onRefine: (instruction: string) => void;
}

export function PhotoRefineDialog({ open, src, onClose, onRefine }: Props) {
  const [ins, setIns] = useState('');
  const close = () => { setIns(''); onClose(); }; // 关闭即清空，下次打开是空的(不在 effect 里 setState)

  if (!src) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>精修这张图</DialogTitle>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="max-h-64 w-full rounded border object-contain" />
        <textarea
          value={ins}
          onChange={(e) => setIns(e.target.value)}
          rows={3}
          placeholder="说要怎么改，比如：背景换成海滩 / 提高对比度 / 模特换个角度。留空 = 轻度优化"
          className="w-full resize-y rounded-md border border-input bg-background p-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">精修结果作为新图进图库，原图保留；不满意可再精修或删除。</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>取消</Button>
          <Button onClick={() => { onRefine(ins); close(); }}>精修（再出一张）</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
