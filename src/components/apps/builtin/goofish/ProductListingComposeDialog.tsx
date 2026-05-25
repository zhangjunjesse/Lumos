'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';

export function ProductListingComposeDialog({
  title,
  description,
  price,
  images,
  onClose,
}: {
  title: string;
  description: string;
  price: number;
  images: string[];
  onClose: () => void;
}): React.ReactElement {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (text: string, label: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(text);
    if (typeof window !== 'undefined') window.alert(`已复制${label}`);
  };

  const fullText = [
    `标题: ${title}`,
    `价格: ￥${price}`,
    '',
    description,
  ].join('\n');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">商品上架内容</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          闲鱼发布只能在 APP 内完成。请把下面 4 项分别用到 APP 的对应输入框。
        </p>

        <Field label="标题">
          <div className="flex gap-2">
            <pre className="flex-1 rounded-md border bg-background px-2 py-1.5 text-xs">{title}</pre>
            <Button size="xs" variant="outline" onClick={() => void copy(title, '标题')}>复制</Button>
          </div>
        </Field>

        <Field label="价格">
          <div className="flex gap-2">
            <pre className="flex-1 rounded-md border bg-background px-2 py-1.5 text-xs">￥{price}</pre>
            <Button size="xs" variant="outline" onClick={() => void copy(String(price), '价格')}>复制</Button>
          </div>
        </Field>

        <Field label="商品描述">
          <div className="flex gap-2">
            <pre className="flex-1 whitespace-pre-wrap rounded-md border bg-background px-2 py-1.5 text-xs leading-5 [overflow-wrap:anywhere]">
              {description || '（空）'}
            </pre>
            <Button size="xs" variant="outline" onClick={() => void copy(description, '描述')}>复制</Button>
          </div>
        </Field>

        <Field label={`预览图（${images.length}）`}>
          {images.length === 0 ? (
            <p className="text-xs text-muted-foreground">这件商品还没有预览图，请到商品详情上传。</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((src, i) => (
                  <a
                    key={`${i}-${src.slice(-12)}`}
                    href={src}
                    download={`preview-${i + 1}.jpg`}
                    className="block aspect-square overflow-hidden rounded-md border"
                    title="右键 / 长按可保存"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`preview-${i}`} className="size-full object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                右键 / 长按图片可保存到本地，然后在闲鱼 APP 选择「从相册上传」。
              </p>
            </>
          )}
        </Field>

        <div className="mt-4 flex justify-between gap-2 border-t pt-3">
          <Button size="sm" variant="outline" onClick={() => void copy(fullText, '全部文字（标题+价格+描述）')}>
            一键复制标题+价格+描述
          </Button>
          <Button size="sm" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-col gap-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
