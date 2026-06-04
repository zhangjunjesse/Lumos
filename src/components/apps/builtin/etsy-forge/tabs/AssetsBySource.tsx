'use client';

// 按来源视图：每个分析过的商品一组——显示原图 + 由它生成的场景/模特/产品 + 进度状态。

import type { AssetItem, LibProduct } from '../api-client';
import { AssetCard } from './AssetCard';

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  running: { text: '生成中…', cls: 'text-amber-600' },
  success: { text: '完成', cls: 'text-emerald-600 dark:text-emerald-400' },
  partial: { text: '部分完成', cls: 'text-amber-600' },
  failed: { text: '失败', cls: 'text-destructive' },
};

// 素材类(跟产品相关)的展示顺序:印花 → 产品图 → 场景 → 模特 → 姿势。
const MAT_ORDER = ['design', 'product', 'scene', 'model', 'pose'];

export function AssetsBySource({
  products,
  assets,
  onView,
  onViewOrig,
  onRemove,
  onRetry,
  onSeries,
  onRemix,
  onFission,
  fissioningIds,
}: {
  products: LibProduct[];
  assets: AssetItem[];
  onView: (id: string) => void;
  onViewOrig: (url: string) => void;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => Promise<void>;
  onSeries?: (asset: AssetItem) => void;
  onRemix?: (asset: AssetItem) => void;
  onFission?: (asset: AssetItem) => void;
  fissioningIds?: Set<string>;
}) {
  const withAssets = new Set(assets.map((a) => a.source_product_id).filter((x): x is string => !!x));
  const rows = products.filter(
    (p) =>
      (p.asset_status && p.asset_status !== 'idle') ||
      (p.pose_status && p.pose_status !== 'idle') ||
      (p.cutout_status && p.cutout_status !== 'idle') ||
      withAssets.has(p.product_id),
  );
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        还没有处理任务。去「我关注的商品」选商品(或某几张图)点「抠印花」或「生成素材」。
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {rows.map((p) => {
        const its = assets.filter((a) => a.source_product_id === p.product_id);
        // 分区:素材(印花/产品/场景/模特/姿势) · 二创(remix 非系列衍生) · 系列(remix 系列化衍生)。
        const materials = its
          .filter((a) => MAT_ORDER.includes(a.category))
          .sort((x, y) => MAT_ORDER.indexOf(x.category) - MAT_ORDER.indexOf(y.category));
        const remixes = its.filter((a) => a.category === 'remix' && !a.series_of);
        const series = its.filter((a) => a.category === 'remix' && a.series_of);
        const sections: { title: string; hint: string; items: AssetItem[] }[] = [
          { title: '素材', hint: '印花 / 产品图 / 场景 / 模特 / 姿势', items: materials },
          { title: '二创', hint: '基于印花发散的变体', items: remixes },
          { title: '系列', hint: '某张达标二创扩展出的同系列', items: series },
        ];
        const cSt = p.cutout_status !== 'idle' ? STATUS_LABEL[p.cutout_status] : undefined;
        const aSt = p.asset_status !== 'idle' ? STATUS_LABEL[p.asset_status] : undefined;
        const pSt = p.pose_status !== 'idle' ? STATUS_LABEL[p.pose_status] : undefined;
        return (
          <div key={p.product_id} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="line-clamp-1 flex-1 text-sm font-medium text-foreground">{p.title || '(无标题)'}</span>
              {cSt && <span className={`shrink-0 text-xs ${cSt.cls}`}>抠印花 {cSt.text}</span>}
              {aSt && <span className={`shrink-0 text-xs ${aSt.cls}`}>分析素材 {aSt.text}</span>}
              {pSt && <span className={`shrink-0 text-xs ${pSt.cls}`}>抠姿势 {pSt.text}</span>}
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-muted-foreground">原图</span>
              {p.images.slice(0, 6).map((im) => (
                <button
                  key={im.id}
                  type="button"
                  onClick={() => onViewOrig(im.url)}
                  title="看原图"
                  className="size-12 overflow-hidden rounded border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt="原图" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            {its.length === 0 ? (
              <p className="text-xs text-muted-foreground">{p.asset_status === 'running' || p.pose_status === 'running' ? '生成中…' : '无素材'}</p>
            ) : (
              <div className="space-y-2.5">
                {sections
                  .filter((s) => s.items.length > 0)
                  .map((s) => (
                    <div key={s.title}>
                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                        {s.title} <span className="font-normal">· {s.hint} · {s.items.length}</span>
                      </p>
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-7">
                        {s.items.map((a) => (
                          <AssetCard key={a.id} asset={a} showSource={false} onView={onView} onViewOrig={onViewOrig} onRemove={onRemove} onRetry={onRetry} onSeries={onSeries} onRemix={onRemix} onFission={onFission} fissioning={fissioningIds?.has(a.id)} />
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
