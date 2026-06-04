'use client';

// 裂变工作台(remix_direction_library SOP):诊断 → 方向库选方向 → 规则判 叠加/平行/矩阵 → 出预览 → 盲选 → 定稿(2/4/6) → 迭代(2)。
// 全程读 DB 动态方向库;诊断只建议、库始终可见;出图后台跑、按 fission_run 轮询拉本轮结果。失败如实报。

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type AssetItem, type FissionDiagnosis, type RemixDirection } from '../api-client';
import { planFission, modeLabel, type FissionStage } from '@/lib/etsy-forge/fission-mode';
import { DirectionLibrary } from './DirectionLibrary';

const DEPTHS: { key: 'quick' | 'standard' | 'fine'; label: string; n: number }[] = [
  { key: 'quick', label: '快速(2)', n: 2 },
  { key: 'standard', label: '标准(4)', n: 4 },
  { key: 'fine', label: '精挑(6)', n: 6 },
];
const parseRecipe = (a: AssetItem): string[] => {
  const parts = (a.description || '').split('·');
  return parts.length >= 3 ? parts[2].split('+').filter(Boolean) : [];
};

export function FissionPanel({
  productId,
  baseRef,
  baseAssetId,
  baseTitle,
  onClose,
  onZoom,
}: {
  productId: string;
  baseRef: string; // 母版印花 url
  baseAssetId: string; // 发起的图素材 id(诊断缓存 + 状态显示用)
  baseTitle: string | null;
  onClose: () => void;
  onZoom: (url: string) => void;
}) {
  const [directions, setDirections] = useState<RemixDirection[]>([]);
  const [diag, setDiag] = useState<FissionDiagnosis | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState(1); // DEPTHS 下标,默认标准
  const [run, setRun] = useState<{ id: string; stage: FissionStage; expected: number } | null>(null);
  const [roundAssets, setRoundAssets] = useState<AssetItem[]>([]);
  const [chosenRecipe, setChosenRecipe] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const axisOf = useRef<Map<string, string>>(new Map());

  // force=false:同图有缓存就直接用(不重复分析);force=true:用户点「重新诊断」强制重跑。
  const diagnose = useCallback(
    async (force: boolean) => {
      setDiagnosing(true);
      setError(null);
      try {
        const r = await etsyForgeApi.fissionDiagnose(baseRef, baseAssetId, force);
        setDiag(r.diagnosis);
        if (r.diagnosis.ok && r.diagnosis.recommendCodes.length) setSelected(new Set(r.diagnosis.recommendCodes));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDiagnosing(false);
      }
    },
    [baseRef, baseAssetId],
  );

  useEffect(() => {
    void (async () => {
      try {
        const { directions: ds } = await etsyForgeApi.listDirections();
        setDirections(ds);
        axisOf.current = new Map(ds.map((d) => [d.code, d.axis]));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      void diagnose(false); // 开面板:有缓存直接用,不重复分析
    })();
  }, [diagnose]);

  // 按 fission_run 轮询本轮出图结果,够数或超时停。
  useEffect(() => {
    if (!run) return;
    const deadline = Date.now() + 10 * 60 * 1000;
    const t = setInterval(async () => {
      try {
        const { assets } = await etsyForgeApi.listAssets('remix');
        const mine = assets.filter((a) => a.fission_run === run.id && a.fission_stage === run.stage);
        setRoundAssets(mine);
        if (mine.length >= run.expected || Date.now() > deadline) setRun((r) => (r ? { ...r, expected: -1 } : r)); // -1=已停轮询标记
      } catch {
        /* 轮询抖动忽略 */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [run]);

  const selArr = [...selected].map((code) => ({ code, axis: axisOf.current.get(code) ?? code[0] }));
  const plan = planFission(selArr);
  const toggle = (code: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  const fire = (stage: FissionStage, recipes: string[][], vpr: number) => {
    if (recipes.length === 0) return;
    const id = crypto.randomUUID();
    setRoundAssets([]);
    setError(null);
    setRun({ id, stage, expected: recipes.length * vpr });
    etsyForgeApi
      .fissionGenerate({ productId, baseRef, baseAssetId, recipes, variantsPerRecipe: vpr, stage, fissionRun: id })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const onPreview = () => {
    setChosenRecipe(null);
    fire('preview', plan.recipes, 1);
  };
  // 盲选:只标记选中哪版,不立刻出图 —— 定稿张数让用户在下一步定稿条里选。
  const onPickPreview = (a: AssetItem) => {
    const recipe = parseRecipe(a);
    if (recipe.length > 0) setChosenRecipe(recipe);
  };
  const onFinalize = () => chosenRecipe && fire('finalize', [chosenRecipe], DEPTHS[depth].n);
  const onIterate = () => fire('iterate', [[...selected]], 2);

  const busy = !!run && run.expected !== -1;
  const stageCn = run?.stage === 'finalize' ? '定稿' : run?.stage === 'iterate' ? '迭代' : '预览';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="line-clamp-1 text-sm font-medium" title={baseTitle ?? ''}>裂变 · {baseTitle || '这张印花'}</span>
          <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 md:grid-cols-[260px_1fr]">
          {/* 左:母版 + 诊断 */}
          <div className="space-y-3">
            <button type="button" onClick={() => onZoom(baseRef)} className="block w-full overflow-hidden rounded-md border" title="看大图">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={baseRef} alt="母版印花" className="aspect-square w-full object-contain bg-muted/30" />
            </button>
            <div className="rounded-md border p-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">AI 诊断</span>
                <button type="button" onClick={() => void diagnose(true)} disabled={diagnosing} className="text-[11px] text-sky-600 hover:underline disabled:opacity-50">
                  {diagnosing ? '诊断中…' : '重新诊断'}
                </button>
              </div>
              {diag?.ok ? (
                <div className="space-y-1 text-muted-foreground">
                  <p><span className="text-foreground">强项(别动):</span> {diag.strengths || '—'}</p>
                  <p><span className="text-foreground">80分综合征:</span> {diag.weaknesses.join('；') || '—'}</p>
                  {diag.note && <p className="text-[11px]">{diag.note}</p>}
                  {diag.recommendCodes.length > 0 && <p className="text-[11px] text-sky-600">已按建议预选 ★ 标的方向，可改</p>}
                </div>
              ) : (
                <p className="text-muted-foreground">{diagnosing ? '诊断中…' : diag?.error ? `诊断没出来(可自己翻库选):${diag.error}` : '—'}</p>
              )}
            </div>
          </div>

          {/* 右:方向库 + 模式张数 + 结果 */}
          <div className="space-y-3">
            <DirectionLibrary directions={directions} selected={selected} recommend={new Set(diag?.recommendCodes ?? [])} onToggle={toggle} />

            {/* 预览阶段:张数由模式决定(各方向各 1 张),这里只显示模式+预览张数,不放定稿张数选择器(免误导)。 */}
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
              <span className="text-muted-foreground">{selected.size === 0 ? '先选方向' : `【${modeLabel(plan.mode)}】${plan.note}`}</span>
              <div className="flex-1" />
              <Button size="sm" disabled={selected.size === 0 || busy} onClick={onPreview}>
                {busy && run?.stage === 'preview' ? '出预览中…' : `出预览 · ${plan.recipes.length} 张`}
              </Button>
            </div>

            {error && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}

            {run && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  {stageCn} · {roundAssets.length}/{run.expected === -1 ? roundAssets.length : run.expected}
                  {run.stage === 'preview' && roundAssets.length > 0 && '（预览各 1 张对比） · 点最满意的一张'}
                  {run.stage !== 'preview' && chosenRecipe && ` · 配方 ${chosenRecipe.join('+')}`}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {roundAssets.map((a) => {
                    const chosen = run.stage === 'preview' && chosenRecipe && parseRecipe(a).join('+') === chosenRecipe.join('+');
                    return (
                      <div key={a.id} className={`group relative overflow-hidden rounded border bg-card ${chosen ? 'ring-2 ring-foreground' : ''}`}>
                        {a.url ? (
                          <button
                            type="button"
                            onClick={() => (run.stage === 'preview' ? onPickPreview(a) : onZoom(a.url as string))}
                            title={run.stage === 'preview' ? '选它(下面再定张数出定稿)' : '看大图'}
                            className="block w-full"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.url} alt="裂变结果" className="aspect-square w-full object-cover" />
                          </button>
                        ) : (
                          <div className="flex aspect-square items-center justify-center bg-destructive/5 p-1 text-center text-[9px] text-destructive">{a.failure_reason || '失败'}</div>
                        )}
                        {chosen && <span className="absolute right-1 top-1 rounded bg-foreground px-1 text-[9px] text-background">已选</span>}
                        {a.quality_note && <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 text-[9px] text-white">{a.quality_note}</span>}
                      </div>
                    );
                  })}
                  {busy && Array.from({ length: Math.max(0, run.expected - roundAssets.length) }).map((_, i) => (
                    <div key={`ph${i}`} className="flex aspect-square items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground">生成中…</div>
                  ))}
                </div>

                {/* 盲选后才出现:选定稿张数 → 出定稿。定稿张数只在这里用,不在预览阶段。 */}
                {run.stage === 'preview' && chosenRecipe && !busy && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
                    <span className="text-muted-foreground">已选这版 · 定稿出几张</span>
                    {DEPTHS.map((d, i) => (
                      <button key={d.key} type="button" onClick={() => setDepth(i)} className={`rounded border px-2 py-0.5 ${depth === i ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>
                        {d.label}
                      </button>
                    ))}
                    <Button size="sm" onClick={onFinalize}>出定稿 · {DEPTHS[depth].n} 张</Button>
                  </div>
                )}
                {run.stage !== 'preview' && !busy && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">还差一点？改方向后</span>
                    <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={onIterate}>迭代(出 2 张)</Button>
                    <Button size="sm" variant="ghost" onClick={onClose}>就它了 · 完成</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
