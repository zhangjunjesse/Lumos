'use client';

// 图片裁剪弹框:对一张商品图裁剪(预置比例一键 + 自由拖拽),结果作为新图(原图保留)。
// 纯浏览器 canvas 裁像素,零依赖;落盘走 /listings/crop-photo,新图由调用方追加进图库。
import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  src: string | null;
  onClose: () => void;
  onCropped: (dataUrl: string) => void;
}

interface Box { x: number; y: number; w: number; h: number } // 显示坐标(相对图片左上角)

const RATIOS: { label: string; value: number | null }[] = [
  { label: '自由', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:1 banner', value: 4 },
];

export function ImageCropDialog({ src, onClose, onCropped }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const drag = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; box: Box } | null>(null);

  if (!src) return null;

  const dispW = () => imgRef.current?.clientWidth ?? 0;
  const dispH = () => imgRef.current?.clientHeight ?? 0;

  const clamp = (b: Box): Box => {
    const W = dispW(), H = dispH();
    const w = Math.min(b.w, W), h = Math.min(b.h, H);
    return { x: Math.max(0, Math.min(b.x, W - w)), y: Math.max(0, Math.min(b.y, H - h)), w, h };
  };

  // 按比例(或默认 80%)在图上居中放一个裁剪框。
  const resetBox = (r: number | null) => {
    const W = dispW(), H = dispH();
    if (!W || !H) return;
    let w = W * 0.8, h = H * 0.8;
    if (r) { if (w / h > r) w = h * r; else h = w / r; }
    setBox(clamp({ x: (W - w) / 2, y: (H - h) / 2, w, h }));
  };

  const pickRatio = (r: number | null) => { setRatio(r); resetBox(r); };

  const onPointerDown = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      boxRef.current?.parentElement?.setPointerCapture(e.pointerId);
    } catch {
      /* 个别环境不支持 pointer capture,降级为普通拖拽,不致命 */
    }
    drag.current = { mode, startX: e.clientX, startY: e.clientY, box };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (d.mode === 'move') {
      setBox(clamp({ ...d.box, x: d.box.x + dx, y: d.box.y + dy }));
    } else {
      const w = Math.max(24, d.box.w + dx);
      const h = ratio ? w / ratio : Math.max(24, d.box.h + dy);
      setBox(clamp({ ...d.box, w, h }));
    }
  };
  const endDrag = () => { drag.current = null; };

  const confirm = async () => {
    const img = imgRef.current;
    if (!img || !box) return;
    setBusy(true);
    setErr('');
    try {
      const scaleX = img.naturalWidth / dispW();
      const scaleY = img.naturalHeight / dispH();
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(box.w * scaleX));
      canvas.height = Math.max(1, Math.round(box.h * scaleY));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 不可用');
      ctx.drawImage(img, box.x * scaleX, box.y * scaleY, box.w * scaleX, box.h * scaleY, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png'); // 跨域未授权的图会在此抛 → 提示用户
      onCropped(dataUrl);
      onClose();
    } catch {
      setBusy(false);
      setErr('裁剪失败:这张图可能来自外部站点且未授权跨域读取。对「AI 生成」的本地图可正常裁剪。');
    }
  };

  return (
    <Dialog open={Boolean(src)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>裁剪图片</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {RATIOS.map((r) => (
            <Button key={r.label} size="sm" variant={ratio === r.value ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => pickRatio(r.value)}>
              {r.label}
            </Button>
          ))}
        </div>
        <div className="flex justify-center">
          <div className="relative inline-block select-none" style={{ touchAction: 'none' }} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={src} alt="" draggable={false} onLoad={() => resetBox(ratio)} className="block max-h-[55vh] w-auto rounded border" />
            {box && (
              <div
                ref={boxRef}
                className="absolute cursor-move border-2 border-sky-400 bg-sky-400/10"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                onPointerDown={onPointerDown('move')}
              >
                <span
                  className="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-se-resize rounded-sm bg-sky-400 ring-2 ring-white"
                  onPointerDown={onPointerDown('resize')}
                />
              </div>
            )}
          </div>
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <p className="text-xs text-muted-foreground">拖拽框体移动、右下角手柄缩放;选比例锁定宽高比。裁剪结果作为新图进图库,原图保留。</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={!box || busy} onClick={() => void confirm()}>{busy ? '裁剪中…' : '确认裁剪'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
