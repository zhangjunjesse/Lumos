'use client';

// 采集任务 tab —— 关键词新建任务 + 立即爬（爬 Etsy 列表入商品库）+ 启用/调度/删除。
// 「采集」= 关键词爬 Etsy 商品列表（主图 + EHunt 指标），不调图片服务商。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { etsyForgeApi, type KeywordTask, type TaskSchedule } from '../api-client';

const SCHEDULE_LABELS: Record<TaskSchedule, string> = {
  manual: '仅手动',
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
};
const STATUS_LABELS: Record<string, string> = {
  idle: '待运行',
  running: '运行中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  cancelled: '已取消',
};

export function TasksTab({ onCollected }: { onCollected?: () => void }) {
  const [tasks, setTasks] = useState<KeywordTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState('');
  const [running, setRunning] = useState<Set<string>>(new Set());

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

  const addTask = async () => {
    const kw = newKeyword.trim();
    if (!kw) return;
    setError(null);
    try {
      await etsyForgeApi.createTask(kw);
      setNewKeyword('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runNow = async (id: string) => {
    setError(null);
    setRunning((s) => new Set(s).add(id));
    try {
      const r = await etsyForgeApi.runTaskNow(id);
      await load();
      onCollected?.();
      if (r.productsFound === 0) {
        setError(`没爬到商品：${r.warning ?? '未知原因（可能选择器/反爬/登录墙）'}`);
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

  const patch = async (id: string, p: { enabled?: boolean; schedule?: TaskSchedule }) => {
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
        输入关键词建采集任务，点「立即爬」走浏览器抓 Etsy 搜索结果（主图 + EHunt 指标）入商品列表。EHunt 指标需设置里选 AdsPower 浏览器。
      </p>

      <div className="mb-6 flex items-center gap-2">
        <input
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addTask();
          }}
          placeholder="关键词，例如 vintage dog tshirt"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button disabled={!newKeyword.trim()} onClick={() => void addTask()}>
          + 建任务
        </Button>
      </div>

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
          {tasks.map((t) => {
            const isRunning = running.has(t.id) || t.last_status === 'running';
            return (
              <div key={t.id} className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="text-base font-medium">{t.keyword}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      累积采集 {t.total_collected} 个商品 ·{' '}
                      {t.last_run_at ? new Date(t.last_run_at).toLocaleString() : '从未运行'}
                    </p>
                  </div>
                  <span
                    className={
                      'rounded border px-2 py-0.5 text-[10px] ' +
                      (t.last_status === 'success'
                        ? 'border-emerald-600/40 text-emerald-600 dark:text-emerald-400'
                        : t.last_status === 'failed'
                          ? 'border-destructive/40 text-destructive'
                          : t.last_status === 'running'
                            ? 'border-amber-600/40 text-amber-600 dark:text-amber-400'
                            : 'border-border text-muted-foreground')
                    }
                  >
                    {STATUS_LABELS[t.last_status] ?? t.last_status}
                  </span>
                </div>
                {t.last_status === 'failed' && t.last_failure_reason && (
                  <p className="mb-3 break-words rounded bg-destructive/10 p-2 text-xs text-destructive">
                    {t.last_failure_reason}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={isRunning} onClick={() => void runNow(t.id)}>
                    {isRunning ? '爬取中…' : `立即爬（${t.max_products} 个）`}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void patch(t.id, { enabled: !t.enabled })}>
                    {t.enabled ? '禁用' : '启用'}
                  </Button>
                  <Select value={t.schedule} onValueChange={(v) => void patch(t.id, { schedule: v as TaskSchedule })}>
                    <SelectTrigger className="h-8 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SCHEDULE_LABELS) as TaskSchedule[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {SCHEDULE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void remove(t)}>
                    删除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
