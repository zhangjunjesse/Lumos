'use client';

// 商品图结果库:批量出的图都进这里。点图放大(lightbox);每张 hover → 精修/设主图/删除/加到创作助手；
// 生成中显示转圈占位；末尾「挑图/上传」补图。
import { useState } from 'react';
import { Crop, FileText, ImagePlus, Loader2, RefreshCw, Star, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ListingPhoto } from '@/lib/etsy-forge/listing/types';
import { ImageLightbox } from '../ImageLightbox';
import { QuickAddChat } from '../QuickAddChat';

interface Props {
  photos: ListingPhoto[];
  runningCount: number;
  onRefine: (src: string) => void;
  onEditPrompt: (photo: ListingPhoto) => void;
  onCrop: (src: string) => void;
  onSetMain: (src: string) => void;
  onRemove: (src: string) => void;
  onPick: () => void;
  onUpload: (src: string) => void;
}

export function PhotoGallery({ photos, runningCount, onRefine, onEditPrompt, onCrop, onSetMain, onRemove, onPick, onUpload }: Props) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSrc, setUploadSrc] = useState('');
  const [zoom, setZoom] = useState(-1); // lightbox 当前索引

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {photos.map((p, i) => (
          <div key={p.src} className="group relative overflow-hidden rounded-lg border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.label || ''} loading="lazy" decoding="async" className="aspect-square w-full cursor-zoom-in object-cover" onClick={() => setZoom(i)} />
            {p.isMain && <span className="pointer-events-none absolute left-1 top-1 rounded bg-amber-500 px-1 text-[10px] text-white">主图</span>}
            <QuickAddChat imageUrl={p.src} refLabel="商品图" className="absolute left-1 bottom-1" />
            <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100">
              <button type="button" onClick={() => onRefine(p.src)} title="精修(再出一张)" className="rounded bg-white/90 p-1 hover:bg-white"><RefreshCw className="size-3" /></button>
              <button type="button" onClick={() => onEditPrompt(p)} title="查看/编辑提示词" className="rounded bg-white/90 p-1 hover:bg-white"><FileText className="size-3" /></button>
              <button type="button" onClick={() => onCrop(p.src)} title="裁剪" className="rounded bg-white/90 p-1 hover:bg-white"><Crop className="size-3" /></button>
              {!p.isMain && <button type="button" onClick={() => onSetMain(p.src)} title="设为主图" className="rounded bg-white/90 p-1 hover:bg-white"><Star className="size-3" /></button>}
              <button type="button" onClick={() => onRemove(p.src)} title="删除" className="rounded bg-white/90 p-1 hover:bg-white"><Trash2 className="size-3" /></button>
            </div>
          </div>
        ))}
        {Array.from({ length: runningCount }).map((_, i) => (
          <div key={`run-${i}`} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border bg-muted/40 text-xs text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />生成中…
          </div>
        ))}
        <button type="button" onClick={onPick} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted/50"><ImagePlus className="size-5" />挑图</button>
        <button type="button" onClick={() => setUploadOpen((v) => !v)} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted/50"><Upload className="size-5" />上传</button>
      </div>
      {uploadOpen && (
        <div className="mt-2 flex max-w-md gap-2">
          <input value={uploadSrc} onChange={(e) => setUploadSrc(e.target.value)} placeholder="本地路径或图片链接(尺码图/包装图)" className="h-8 flex-1 rounded border border-input bg-background px-2 text-sm" />
          <Button size="sm" onClick={() => { const s = uploadSrc.trim(); if (s) { onUpload(s); setUploadSrc(''); setUploadOpen(false); } }}>用这张</Button>
        </div>
      )}
      {zoom >= 0 && photos[zoom] && (
        <ImageLightbox images={photos.map((p) => ({ url: p.src, title: p.label }))} index={zoom} onIndexChange={setZoom} onClose={() => setZoom(-1)} />
      )}
    </div>
  );
}
