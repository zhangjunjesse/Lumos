'use client';

// 内联生成条(MidJourney 式):选参考图(默认带本组的印花/产品图,点「＋加图」可跨产品/图库任意加) + 写提示词 + 生成。
// 生成的新图挂到目标产品(productId)下,新增一张。不弹框。

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi } from '../api-client';

export interface RefImage {
  url: string;
  label: string;
}

export function ProductComposer({
  productId,
  defaultRefs,
  libraryRefs,
  onStarted,
  onError,
  onZoom,
}: {
  productId: string;
  defaultRefs: RefImage[]; // 本组现成的图(印花/产品图),作快捷参考
  libraryRefs: RefImage[]; // 全部图(跨产品/图库),点「＋加图」里挑
  onStarted: () => void; // 已发起,父组件去轮询
  onError: (s: string) => void;
  onZoom: (url: string) => void; // 点参考图角标看大图
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = (url: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  // 加图选择器里展示「全部图」中不在 defaultRefs 里的(默认那些已在上面列出)。
  const defaultUrls = new Set(defaultRefs.map((r) => r.url));
  const extraRefs = libraryRefs.filter((r) => !defaultUrls.has(r.url));

  const go = () => {
    const p = prompt.trim();
    if (!p || selected.size === 0 || busy) return;
    setBusy(true);
    etsyForgeApi
      .composeProduct(productId, [...selected], p)
      .then(() => {
        onStarted();
        setPrompt('');
        setSelected(new Set());
        setPickerOpen(false);
      })
      .catch((e) => onError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const chip = (r: RefImage) => (
    <div
      key={r.url}
      className={`relative size-12 shrink-0 overflow-hidden rounded border ${selected.has(r.url) ? 'ring-2 ring-foreground' : 'hover:ring-1 hover:ring-foreground'}`}
    >
      <button type="button" onClick={() => toggle(r.url)} title={`${r.label} · 点击${selected.has(r.url) ? '取消选择' : '选择'}`} className="block size-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.url} alt={r.label} className="size-full object-cover" />
      </button>
      {selected.has(r.url) && <span className="pointer-events-none absolute right-0 top-0 bg-foreground px-1 text-[8px] text-background">✓</span>}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onZoom(r.url);
        }}
        title="看大图"
        className="absolute bottom-0 left-0 bg-black/55 px-1 text-[9px] leading-tight text-white hover:bg-black/80"
      >
        🔍
      </button>
    </div>
  );

  return (
    <div className="mt-2 rounded-md border bg-muted/30 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">参考图(至少选 1 张,可多选;🔍看大图) · 已选 {selected.size}</span>
        {defaultRefs.map(chip)}
        {extraRefs.length > 0 && (
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex size-12 shrink-0 items-center justify-center rounded border border-dashed text-[10px] text-muted-foreground hover:bg-muted"
          >
            ＋加图{selected.size > defaultRefs.filter((r) => selected.has(r.url)).length ? `(${selected.size})` : ''}
          </button>
        )}
      </div>

      {pickerOpen && (
        <div className="mb-2 max-h-40 overflow-y-auto rounded border bg-card p-1.5">
          <p className="mb-1 px-0.5 text-[10px] text-muted-foreground">从所有图里挑(可跨产品/图库) · 已选 {selected.size}</p>
          <div className="flex flex-wrap gap-1.5">{extraRefs.map(chip)}</div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="描述你想要的，比如：把印花印到这件深色T上、换成低饱和鼠尾草绿、把背景去掉…"
          className="min-h-[40px] flex-1 resize-y rounded-md border border-input bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go();
          }}
        />
        <Button size="sm" disabled={!prompt.trim() || selected.size === 0 || busy} onClick={go}>
          {busy ? '发起中…' : '生成'}
        </Button>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">需至少选 1 张参考图 + 写提示词 · ⌘/Ctrl+Enter 生成 · 结果挂到这个产品下、后台跑、稍等出现。</p>
    </div>
  );
}
