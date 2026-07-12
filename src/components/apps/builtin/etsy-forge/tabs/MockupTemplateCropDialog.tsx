'use client';

// T恤模板 印花区框选弹层:在底图大图上按下拖拽画矩形选印花区,松开确定。
// 坐标换算:显示系(展示宽度)↔ 原图像素系(print_area 存原图像素)。保存回传 PATCH。

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MockupTemplate, PrintArea } from '../api-client';

const serve = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;
const DISPLAY_W = 460; // 弹层里底图展示宽度(px);高度按原图比例算

type Rect = { x: number; y: number; w: number; h: number }; // 显示系

export function MockupTemplateCropDialog({
  template,
  open,
  onOpenChange,
  onSave,
}: {
  template: MockupTemplate;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (area: PrintArea) => void;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const scale = nat ? DISPLAY_W / nat.w : 1; // 原图→显示
  const displayH = nat ? nat.h * scale : 0;

  // 图片加载后:拿原图像素尺寸,把已存的 print_area 换算成显示系初始矩形。
  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const w = e.currentTarget.naturalWidth || DISPLAY_W;
    const h = e.currentTarget.naturalHeight || DISPLAY_W;
    setNat({ w, h });
    const s = DISPLAY_W / w;
    const a = template.print_area;
    setRect({ x: a.x * s, y: a.y * s, w: a.w * s, h: a.h * s });
  };

  const localXY = (e: React.MouseEvent) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
    return { x: clamp(e.clientX - box.left, DISPLAY_W), y: clamp(e.clientY - box.top, displayH) };
  };
  const onDown = (e: React.MouseEvent) => {
    const p = localXY(e);
    dragStart.current = p;
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const s = dragStart.current;
    const p = localXY(e);
    setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = () => {
    dragStart.current = null;
  };

  // 显示系矩形 → 原图像素系(取整)。
  const toPixels = (r: Rect): PrintArea => ({
    x: Math.round(r.x / scale),
    y: Math.round(r.y / scale),
    w: Math.round(r.w / scale),
    h: Math.round(r.h / scale),
  });
  const px = rect && nat ? toPixels(rect) : null;
  const valid = !!px && px.w > 4 && px.h > 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>框选印花区 · {template.name}</DialogTitle>
          <DialogDescription>在底图上按住拖动画一个矩形框住印花区,松开确定。坐标以底图原始像素计。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center">
          <div
            ref={boxRef}
            className="relative select-none overflow-hidden rounded border bg-muted"
            style={{ width: DISPLAY_W, height: displayH || DISPLAY_W }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={serve(template.base_path)} alt={template.name} onLoad={onImgLoad} className="pointer-events-none block w-full" draggable={false} />
            {rect && (
              <div
                className="pointer-events-none absolute border-2 border-sky-500 bg-sky-500/20 ring-1 ring-inset ring-white/60"
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              />
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {nat ? `底图 ${nat.w}×${nat.h}px` : '加载底图…'}
            {px ? ` · 印花区 x:${px.x} y:${px.y} w:${px.w} h:${px.h}` : ''}
          </p>
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={!valid} onClick={() => px && onSave(px)}>
            保存印花区
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
