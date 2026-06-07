'use client';

// 商品列表 tab —— 第一步采集结果。按「每次执行（批次）」分组展示：同一任务反复跑，每次执行各成一组。
// 组内主图 + EHunt 指标 + 勾选；支持按销量/收藏排序、按最低销量/收藏筛选；勾选后「爬选中详情图」入图库。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type Product } from '../api-client';
import { ProductCard } from './ProductCard';
import { RemixDirectionMenu } from './RemixDirectionMenu';
import { useOneClickSop } from './use-one-click-sop';
import { type SortBy, salesOf, favsOf, buildRunGroups } from './product-sort';

export function ProductsTab({ onCollectedDetails }: { onCollectedDetails?: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortBy>('default');
  const [minSales, setMinSales] = useState(0);
  const [minFavs, setMinFavs] = useState(0);
  const { sopStarting, startSop } = useOneClickSop();

  const toggleCollapse = (runId: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(runId)) n.delete(runId);
      else n.add(runId);
      return n;
    });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await etsyForgeApi.listProducts();
      setProducts(res.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // 进入「已采集商品」时清空之前残留的选中(选中是持久化在 DB 的,换 tab 回来会残留)。挂载时清一次。
  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await etsyForgeApi.listProducts();
        const sel = res.products.filter((p) => p.selected).map((p) => p.id);
        if (sel.length) await etsyForgeApi.setSelected(sel, false).catch(() => {});
        setProducts(res.products.map((p) => (p.selected ? { ...p, selected: false } : p)));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedIds = products.filter((p) => p.selected).map((p) => p.id);

  // 筛选：最低销量/收藏（无 EHunt 指标的按 0 计，阈值 >0 时会被筛掉）
  const visibleProducts = useMemo(
    () => products.filter((p) => salesOf(p) >= minSales && favsOf(p) >= minFavs),
    [products, minSales, minFavs],
  );
  const filtering = minSales > 0 || minFavs > 0;

  const groups = useMemo(() => buildRunGroups(visibleProducts, sortBy), [visibleProducts, sortBy]);

  const setSelectedFor = async (ids: string[], selected: boolean) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setProducts((arr) => arr.map((x) => (idSet.has(x.id) ? { ...x, selected } : x)));
    try {
      await etsyForgeApi.setSelected(ids, selected);
    } catch {
      void load();
    }
  };

  const toggle = (p: Product) => void setSelectedFor([p.id], !p.selected);

  const collectDetails = async () => {
    if (selectedIds.length === 0) return;
    const ids = [...selectedIds]; // 锁定本次队列，避免采集期间选中变化
    if (!confirm(`爬 ${ids.length} 个选中商品的详情页所有详情图？走浏览器，约每个 5-10 秒。`)) return;
    setCollecting(true);
    setMsg(null);
    setError(null);
    try {
      const r = await etsyForgeApi.collectDetails(ids);
      // 采完清空本次选中（选中=待采集队列）：否则残留选中会在下次加选新商品时被重复采集。
      await etsyForgeApi.setSelected(ids, false).catch(() => {});
      setMsg(
        `完成：${r.okProducts} 个成功、${r.failProducts} 个失败，共 ${r.totalImages} 张详情图入库。选中已清空。`,
      );
      await load();
      onCollectedDetails?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCollecting(false);
    }
  };

  // 一键出品 SOP：对选中商品逐个走完整链(采集→评论→分类→抠印花→素材+姿势→二创→出产品图)。
  // directions = 用户在下拉里勾的二创方向矩阵(可多选,默认 B),透传到链里的二创步。
  const startOneClick = async (directions: string[]) => {
    setMsg(null);
    setError(null);
    const err = await startSop([...selectedIds], directions);
    if (err) setError(err);
    else setMsg('已发起「一键出品」，进度去右下角「任务」按钮看。');
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`确认删除选中的 ${selectedIds.length} 个商品？连带其已采详情图一起删，不可恢复。`)) return;
    setDeleting(true);
    setMsg(null);
    setError(null);
    try {
      const r = await etsyForgeApi.deleteLibrary({ productIds: selectedIds });
      setMsg(`已删除 ${r.deletedProducts} 个商品、${r.deletedImages} 张详情图。`);
      await load();
      onCollectedDetails?.(); // 同步刷新图库
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const selectClass =
    'h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {filtering ? `${visibleProducts.length}/${products.length}` : products.length} 个商品 · {groups.length} 次执行 · 已选{' '}
          {selectedIds.length}
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={groups.length === 0}
          onClick={() => {
            const ids = groups.map((g) => g.runId);
            const allCollapsed = ids.every((id) => collapsed.has(id));
            setCollapsed(allCollapsed ? new Set() : new Set(ids));
          }}
        >
          {groups.length > 0 && groups.every((g) => collapsed.has(g.runId)) ? '全部展开' : '全部折叠'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void setSelectedFor(visibleProducts.map((p) => p.id), true)}
          disabled={visibleProducts.length === 0}
        >
          全选
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void setSelectedFor(products.map((p) => p.id), false)}
          disabled={selectedIds.length === 0}
        >
          清空选择
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={() => void deleteSelected()}
          disabled={deleting || selectedIds.length === 0}
        >
          {deleting ? '删除中…' : `删除选中 ${selectedIds.length} 个`}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void collectDetails()} disabled={collecting || selectedIds.length === 0}>
          {collecting ? '爬详情图中…' : `爬选中 ${selectedIds.length} 个的详情图`}
        </Button>
        <RemixDirectionMenu
          triggerLabel={`一键出品 ${selectedIds.length} 个`}
          confirmLabel="开始一键出品"
          disabled={selectedIds.length === 0}
          busy={sopStarting}
          onConfirm={(dirs) => void startOneClick(dirs)}
        />
      </div>

      {/* 排序 + 筛选条 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-card px-3 py-2 text-xs">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          排序
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className={selectClass}>
            <option value="default">采集顺序</option>
            <option value="sales">销量高→低</option>
            <option value="favorites">收藏高→低</option>
            <option value="price">价格低→高</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          最低销量
          <input
            type="number"
            min={0}
            value={minSales}
            onChange={(e) => setMinSales(Math.max(0, Number(e.target.value) || 0))}
            className={`${selectClass} w-20`}
          />
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          最低收藏
          <input
            type="number"
            min={0}
            value={minFavs}
            onChange={(e) => setMinFavs(Math.max(0, Number(e.target.value) || 0))}
            className={`${selectClass} w-20`}
          />
        </label>
        {filtering && (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setMinSales(0);
              setMinFavs(0);
            }}
          >
            清除筛选
          </button>
        )}
        <span className="text-[11px] text-muted-foreground">（排序/筛选按 EHunt 指标，无指标的按 0 计）</span>
      </div>

      {msg && <p className="mb-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">{msg}</p>}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!loading && products.length === 0 && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          还没有商品。去「采集任务」建关键词任务并「立即爬」。
        </div>
      )}
      {!loading && products.length > 0 && groups.length === 0 && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          没有符合筛选条件的商品，调低最低销量/收藏试试。
        </div>
      )}

      {!loading &&
        groups.map((g) => {
          const groupSelected = g.items.filter((p) => p.selected).length;
          const isCollapsed = collapsed.has(g.runId);
          return (
            <section key={g.runId} className="mb-8">
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b pb-2">
                <button
                  type="button"
                  onClick={() => toggleCollapse(g.runId)}
                  title={isCollapsed ? '展开本批' : '折叠本批'}
                  className="flex items-center gap-1.5 rounded bg-foreground px-2 py-0.5 text-[11px] font-medium text-background"
                >
                  <span className="text-[9px]">{isCollapsed ? '▶' : '▼'}</span>第 {g.seq} 次执行
                </button>
                <h3 className="text-sm font-medium text-foreground">{g.keyword}</h3>
                <span className="text-xs text-muted-foreground">
                  {g.runAt ? new Date(g.runAt).toLocaleString() : '—'} · {g.items.length} 个 · 已选 {groupSelected}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    void setSelectedFor(
                      g.items.map((p) => p.id),
                      groupSelected < g.items.length,
                    )
                  }
                >
                  {groupSelected < g.items.length ? '选中本批' : '取消本批'}
                </button>
              </div>
              {!isCollapsed && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {g.items.map((p) => (
                    <ProductCard key={p.id} product={p} onToggle={toggle} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
    </div>
  );
}
