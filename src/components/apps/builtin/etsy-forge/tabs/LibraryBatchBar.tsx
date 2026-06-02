'use client';

// 图库选择模式下的批量操作栏：标签(加/去，仅商品维度) + 抠印花(独立) + 生成素材(下拉) + 删除。
// 抠印花单独拎出来——它是"商品多图合起来出 1 张印花"，选图粒度和"生成素材"不同。
// 生成素材下拉里勾选 分析素材 / 抠姿势，主按钮跑勾选的。

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PipelineSteps } from './use-library-actions';
import { REMIX_DIRECTIONS } from '@/lib/etsy-forge/remix-axes';

const STEP_DEFS: { key: keyof PipelineSteps; label: string; hint: string }[] = [
  { key: 'analyze', label: '分析素材', hint: '生成场景/模特/产品图' },
  { key: 'pose', label: '抠姿势', hint: '逐张抠模特，需选含模特的图' },
];

export function LibraryBatchBar({
  selectedProductCount,
  selectedImageCount,
  allTags,
  busy,
  onAddTag,
  onRemoveTag,
  onCutout,
  onPipeline,
  onRemix,
  onDelete,
  onClear,
}: {
  selectedProductCount: number;
  selectedImageCount: number;
  allTags: string[];
  busy: boolean;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onCutout: () => void;
  onPipeline: (steps: PipelineSteps) => void;
  onRemix: (directions: string[]) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [tag, setTag] = useState('');
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<PipelineSteps>({ analyze: true, pose: false });
  const [remixOpen, setRemixOpen] = useState(false);
  const [remixDirs, setRemixDirs] = useState<Set<string>>(new Set(['B'])); // 二创方向矩阵,默认 B
  const nothingSelected = selectedProductCount === 0 && selectedImageCount === 0;
  const tagValue = tag.trim();
  const anyStep = steps.analyze || steps.pose;
  const chosen = STEP_DEFS.filter((s) => steps[s.key])
    .map((s) => s.label)
    .join('+');

  const fireTag = (fn: (t: string) => void) => {
    if (!tagValue) return;
    fn(tagValue);
    setTag('');
  };
  const start = () => {
    onPipeline(steps);
    setOpen(false);
  };

  return (
    <div className="sticky top-0 z-10 mb-3 rounded-md border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          已选 <span className="font-medium text-foreground">{selectedProductCount}</span> 商品 ·{' '}
          <span className="font-medium text-foreground">{selectedImageCount}</span> 图
        </span>
        <div className="flex-1" />
        <input
          list="etsy-forge-tags"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') fireTag(onAddTag);
          }}
          placeholder="标签，如 候选 / 爆款"
          className="h-8 w-36 rounded-md border border-input bg-background px-2 text-xs"
        />
        <datalist id="etsy-forge-tags">
          {allTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <Button size="sm" variant="outline" disabled={busy || selectedProductCount === 0 || !tagValue} onClick={() => fireTag(onAddTag)}>
          加标签
        </Button>
        <Button size="sm" variant="outline" disabled={busy || selectedProductCount === 0 || !tagValue} onClick={() => fireTag(onRemoveTag)}>
          去标签
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy || nothingSelected}
          title="商品所有图(或选中的几张)合起来抠出 1 张印花，走「提示词管理→抠印花」生效那条"
          onClick={onCutout}
        >
          抠印花
        </Button>

        <div className="relative">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selectedProductCount === 0}
            title="按二创方向矩阵(可多选)对选中商品出变体印花。需先抠印花。"
            onClick={() => setRemixOpen((v) => !v)}
          >
            二创{remixDirs.size > 0 ? `（${remixDirs.size} 方向）` : ''} ▾
          </Button>
          {remixOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setRemixOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
                <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">选二创方向(可多选,默认 B)</p>
                {REMIX_DIRECTIONS.map((d) => (
                  <label key={d.key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={remixDirs.has(d.key)}
                      onChange={() =>
                        setRemixDirs((s) => {
                          const n = new Set(s);
                          if (n.has(d.key)) n.delete(d.key);
                          else n.add(d.key);
                          return n;
                        })
                      }
                      className="mt-0.5 size-3.5 shrink-0 accent-foreground"
                    />
                    <span className="text-xs leading-tight">
                      {d.key} · {d.label}
                      <span className="ml-1 text-[10px] text-muted-foreground">{d.desc}</span>
                    </span>
                  </label>
                ))}
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  disabled={remixDirs.size === 0}
                  onClick={() => {
                    onRemix([...remixDirs]);
                    setRemixOpen(false);
                  }}
                >
                  开始二创
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <Button size="sm" disabled={busy || nothingSelected} onClick={() => setOpen((v) => !v)}>
            生成素材{chosen ? `（${chosen}）` : ''} ▾
          </Button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
                <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">勾选要生成的素材（都走图片服务商）</p>
                {STEP_DEFS.map((s) => (
                  <label key={s.key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={steps[s.key]}
                      onChange={() => setSteps((v) => ({ ...v, [s.key]: !v[s.key] }))}
                      className="mt-0.5 size-3.5 shrink-0 accent-foreground"
                    />
                    <span className="text-xs leading-tight">
                      {s.label}
                      <span className="ml-1 text-[10px] text-muted-foreground">{s.hint}</span>
                    </span>
                  </label>
                ))}
                <Button size="sm" className="mt-2 w-full" disabled={!anyStep} onClick={start}>
                  开始处理
                </Button>
              </div>
            </>
          )}
        </div>

        <Button
          size="sm"
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
          disabled={busy || nothingSelected}
          onClick={onDelete}
        >
          删除
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={onClear}>
          取消
        </Button>
      </div>
      {selectedProductCount === 0 && selectedImageCount > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">标签只对商品生效；当前只选了图，可直接「抠印花」「生成素材」或「删除」。</p>
      )}
    </div>
  );
}
