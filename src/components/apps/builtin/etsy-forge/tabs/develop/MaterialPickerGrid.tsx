'use client';

// 一类素材的选择网格。single=单选(模特)，multi=多选。每张 hover 可放大(🔍) + 加到创作助手(＋)。
import { QuickAddChat } from '../QuickAddChat';

export interface BaseMaterial {
  src: string;
  label: string;
}

interface Props {
  title: string;
  materials: BaseMaterial[];
  mode: 'single' | 'multi';
  selected: string[];
  onChange: (srcs: string[]) => void;
  onZoom?: (src: string) => void;
  emptyHint?: string;
}

export function MaterialPickerGrid({ title, materials, mode, selected, onChange, onZoom, emptyHint }: Props) {
  const toggle = (src: string) => {
    if (mode === 'single') return onChange(selected[0] === src ? [] : [src]);
    onChange(selected.includes(src) ? selected.filter((s) => s !== src) : [...selected, src]);
  };

  return (
    <div>
      <p className="mb-1 text-sm font-medium">
        {title}{' '}
        <span className="text-xs font-normal text-muted-foreground">{mode === 'single' ? '(单选)' : `(可多选 · 已选 ${selected.length})`}</span>
      </p>
      {materials.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint ?? '图库暂无此类素材'}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {materials.map((m) => {
            const on = selected.includes(m.src);
            return (
              <div key={m.src} className={`group relative size-16 overflow-hidden rounded-lg border ${on ? 'ring-2 ring-foreground' : 'hover:ring-1 hover:ring-foreground'}`} title={m.label}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.src} alt={m.label} onClick={() => toggle(m.src)} className="size-full cursor-pointer object-cover" />
                {on && <span className="pointer-events-none absolute right-0 top-0 bg-foreground px-1 text-[9px] text-background">✓</span>}
                <div className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  {onZoom && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); onZoom(m.src); }} title="放大" className="flex size-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white hover:bg-black/80">🔍</button>
                  )}
                  <QuickAddChat imageUrl={m.src} refLabel="参考图" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
