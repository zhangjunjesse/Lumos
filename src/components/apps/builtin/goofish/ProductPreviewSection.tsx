'use client';

import * as React from 'react';
import { Image as ImageIcon, Loader2, Sparkles, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { nativeActionUrl } from './use-goofish-app-data';
import type { Product, ProductDraft } from './use-products';

const MAX_IMAGES = 6;
const MAX_DIM = 1280;
const JPEG_QUALITY = 0.85;
const MAX_BYTES_PER_IMAGE = 800 * 1024;

export function ProductPreviewSection({
  product,
  draft,
  onChange,
}: {
  product: Product | null;
  draft: ProductDraft;
  onChange: (patch: ProductDraft) => void;
}): React.ReactElement {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = React.useState<'banner' | 'compress' | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const images = React.useMemo<string[]>(
    () => draft.preview_image_paths ?? [],
    [draft.preview_image_paths],
  );

  const handleUpload = React.useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setWarning(null);
      setBusy('compress');
      try {
        const arr = Array.from(files).slice(0, MAX_IMAGES - images.length);
        const compressed: string[] = [];
        for (const f of arr) {
          try {
            compressed.push(await compressImage(f));
          } catch (err) {
            console.warn('[products] image compress failed', err);
          }
        }
        if (compressed.length === 0) {
          setWarning('图片处理失败，请换一张试试。');
          return;
        }
        onChange({ preview_image_paths: [...images, ...compressed] });
        if (compressed.length < arr.length) {
          setWarning(`已成功处理 ${compressed.length}/${arr.length} 张，部分图片解码失败。`);
        }
      } finally {
        setBusy(null);
      }
    },
    [images, onChange],
  );

  const removeAt = React.useCallback(
    (idx: number) => {
      const next = images.filter((_, i) => i !== idx);
      onChange({ preview_image_paths: next });
    },
    [images, onChange],
  );

  const generateBanner = React.useCallback(async () => {
    setBusy('banner');
    setWarning(null);
    try {
      const res = await fetch(nativeActionUrl('goofish', 'generate-product-preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title ?? '',
          summary: draft.summary ?? '',
          category: draft.category ?? '',
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        imagePath?: string;
        message?: string;
      };
      if (!res.ok || !json.ok || !json.imagePath) {
        throw new Error(json.message ?? '生成 banner 失败');
      }
      onChange({ preview_image_paths: [json.imagePath, ...images].slice(0, MAX_IMAGES) });
    } catch (err) {
      setWarning(err instanceof Error ? err.message : 'banner 生成失败');
    } finally {
      setBusy(null);
    }
  }, [draft, images, onChange]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          商品预览图（{images.length}/{MAX_IMAGES}）
        </h4>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void generateBanner()}
            disabled={busy !== null || !draft.title || images.length >= MAX_IMAGES}
          >
            {busy === 'banner'
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Sparkles className="size-3.5" />}
            AI 生成 banner
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy !== null || images.length >= MAX_IMAGES}
          >
            {busy === 'compress'
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Upload className="size-3.5" />}
            上传图片
          </Button>
        </div>
      </div>

      <Input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleUpload(e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />

      {warning ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          {warning}
        </p>
      ) : null}

      {images.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground">
          <ImageIcon className="size-4" />
          上传 3-6 张商品预览图（封面、目录、内页样张等）
          <span className="text-[10px]">单张超过 1280×1280 会自动压缩，超过 800KB 会再压一次</span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-6">
          {images.map((src, idx) => (
            <div
              key={imageKey(src, idx)}
              className="group relative aspect-square overflow-hidden rounded-lg border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`preview-${idx}`} className="size-full object-cover" loading="lazy" />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="absolute right-1 top-1 rounded-full bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                title="移除"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {product ? (
        <p className="text-[10px] text-muted-foreground">
          商品 ID: <code className="rounded bg-muted px-1 py-0.5 font-mono">{product.id}</code>
        </p>
      ) : null}
    </section>
  );
}

function imageKey(src: string, idx: number): string {
  let hash = 0;
  for (let i = 0; i < Math.min(src.length, 200); i++) {
    hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0;
  }
  return `${idx}-${hash}`;
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('非图片文件'));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = scaleDown(img.naturalWidth, img.naturalHeight, MAX_DIM);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法获取 canvas 上下文'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      let quality = JPEG_QUALITY;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > MAX_BYTES_PER_IMAGE * 1.34 && quality > 0.4) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

function scaleDown(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w / h;
  if (w >= h) return { width: max, height: Math.round(max / ratio) };
  return { width: Math.round(max * ratio), height: max };
}
