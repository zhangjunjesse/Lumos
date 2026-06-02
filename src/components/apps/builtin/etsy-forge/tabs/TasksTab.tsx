'use client';

// 采集任务 tab —— 关键词新建任务 + 立即爬（爬 Etsy 列表入商品库）+ 启用/调度/门槛/删除。
// 「采集」= 关键词爬 Etsy 商品列表（主图 + EHunt 指标），不调图片服务商。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type KeywordTask } from '../api-client';
import { TaskCard, MAX_CAP, clampMax, clampPriceField, clampPagesField, type TaskPatch } from './TaskCard';

export function TasksTab({ onCollected }: { onCollected?: () => void }) {
  const [tasks, setTasks] = useState<KeywordTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState('');
  const [newMax, setNewMax] = useState(48);
  const [newMinSales, setNewMinSales] = useState(0);
  const [newMinFavorites, setNewMinFavorites] = useState(0);
  const [newMinPrice, setNewMinPrice] = useState(0);
  const [newMaxPrice, setNewMaxPrice] = useState(0);
  const [newMaxPages, setNewMaxPages] = useState(40);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await etsyForgeApi.listTasks();
      setTasks(res.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 有任务在跑(本地发起的 or DB 残留 running)时轮询刷新,让停止收尾/终态及时反映,跨刷新也不丢。
  const anyRunning = running.size > 0 || stopping.size > 0 || tasks.some((t) => t.last_status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [anyRunning, load]);

  const addTask = async () => {
    const kw = newKeyword.trim();
    if (!kw) return;
    setError(null);
    try {
      await etsyForgeApi.createTask(kw, {
        maxProducts: clampMax(newMax),
        minSales: Math.max(0, Math.floor(newMinSales) || 0),
        minFavorites: Math.max(0, Math.floor(newMinFavorites) || 0),
        minPrice: clampPriceField(newMinPrice),
        maxPrice: clampPriceField(newMaxPrice),
        maxPages: clampPagesField(newMaxPages),
      });
      setNewKeyword('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runNow = async (id: string) => {
    setError(null);
    setRunMsg(null);
    setRunning((s) => new Set(s).add(id));
    try {
      const r = await etsyForgeApi.runTaskNow(id);
      await load();
      onCollected?.();
      if (r.productsFound === 0) {
        setError(`没爬到商品：${r.warning ?? '未知原因（可能选择器/反爬/登录墙）'}`);
      } else {
        setRunMsg(
          `本次执行爬到 ${r.productsFound} 个商品（单独成一批，去「已采集商品」看这一批）` +
            (r.ehuntHitCount > 0 ? ` · EHunt 命中 ${r.ehuntHitCount}` : ' · 无 EHunt 指标') +
            (r.warning ? ` · ${r.warning}` : ''),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const stopTask = async (id: string) => {
    setError(null);
    setStopping((s) => new Set(s).add(id));
    try {
      const r = await etsyForgeApi.stopTask(id);
      setRunMsg(r.stopping ? '已请求停止，翻完手头这页就收手（已爬到的保留入库）…' : '任务已收尾。');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const patch = async (id: string, p: TaskPatch) => {
    try {
      await etsyForgeApi.updateTask(id, p);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (t: KeywordTask) => {
    if (!confirm(`删除关键词任务「${t.keyword}」？已采集的商品不会删。`)) return;
    try {
      await etsyForgeApi.deleteTask(t.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-4 text-sm text-muted-foreground">
        输入关键词建采集任务，点「立即爬」走浏览器抓 Etsy 搜索结果（主图 + EHunt 指标）入「已采集商品」。EHunt 指标需设置里选 AdsPower 浏览器。
      </p>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addTask();
          }}
          placeholder="关键词，例如 vintage dog tshirt"
          className="h-9 min-w-48 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          数量
          <input
            type="number"
            min={1}
            max={MAX_CAP}
            value={newMax}
            onChange={(e) => setNewMax(Number(e.target.value))}
            title="想爬多少个商品（自动翻页，上限 500）"
            className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          翻页
          <input
            type="number"
            min={1}
            max={100}
            value={newMaxPages}
            onChange={(e) => setNewMaxPages(Number(e.target.value))}
            title="最大翻页数（往深里翻多少页找达标新品，默认 40，上限 100）"
            className="h-9 w-16 rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <Button disabled={!newKeyword.trim()} onClick={() => void addTask()}>
          + 建任务
        </Button>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        采集门槛
        <label className="flex items-center gap-1">
          销量≥
          <input
            type="number"
            min={0}
            value={newMinSales}
            onChange={(e) => setNewMinSales(Number(e.target.value))}
            title="销量低于此值不采（0=不过滤）"
            className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="flex items-center gap-1">
          收藏≥
          <input
            type="number"
            min={0}
            value={newMinFavorites}
            onChange={(e) => setNewMinFavorites(Number(e.target.value))}
            title="收藏低于此值不采（0=不过滤）"
            className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="flex items-center gap-1">
          价格
          <input
            type="number"
            min={0}
            step={0.01}
            value={newMinPrice}
            onChange={(e) => setNewMinPrice(Number(e.target.value))}
            title="价格低于此值不采（0=不限，按商品标价）"
            className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
          />
          –
          <input
            type="number"
            min={0}
            step={0.01}
            value={newMaxPrice}
            onChange={(e) => setNewMaxPrice(Number(e.target.value))}
            title="价格高于此值不采（0=不限，按商品标价）"
            className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <span className="text-xs">0=不过滤 · 销量/收藏需 EHunt(AdsPower)，价格按标价</span>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        想爬多少个自己填（上限 500）。设了门槛只采达标的，靠 EHunt 指标；非 AdsPower 拿不到指标会按 0 计、被全过滤。同一任务每次执行单独成一批，「已采集商品」按批次分开展示。
      </p>

      {runMsg && (
        <div className="mb-4 rounded-md border border-emerald-600/40 bg-emerald-600/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          {runMsg}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!loading && tasks.length === 0 && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          还没有采集任务。上面输入关键词建一个。
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="space-y-3">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              running={running.has(t.id)}
              stopping={stopping.has(t.id)}
              onRun={() => void runNow(t.id)}
              onStop={() => void stopTask(t.id)}
              onPatch={(p) => void patch(t.id, p)}
              onRemove={() => void remove(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
