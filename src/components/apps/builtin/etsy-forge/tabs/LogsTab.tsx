'use client';

// 日志 tab —— 排查用。重点记图片生成(抠印花/分析素材/抠姿势/产品合成/重试)的成功(model/耗时)和失败(原因)。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type LogItem } from '../api-client';
import { LogRowItem } from './LogRowItem';

export function LogsTab() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await etsyForgeApi.listLogs();
      setLogs(r.logs);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 勾了自动刷新就每 5s 拉一次，看实时进度。
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [auto, load]);

  const clear = async () => {
    if (!confirm('清空所有日志？')) return;
    await etsyForgeApi.clearLogs().catch(() => {});
    await load();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">最近 {logs.length} 条 · 重点记图片生成成败（模型/耗时/错误）</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="size-3.5 accent-foreground" />
          自动刷新
        </label>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          刷新
        </Button>
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => void clear()}>
          清空
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : logs.length === 0 ? (
        <p className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          还没有日志。去抠印花 / 分析素材 / 产品合成 跑一次就有了。
        </p>
      ) : (
        <div className="space-y-1.5">
          {logs.map((l) => (
            <LogRowItem key={l.id} log={l} />
          ))}
        </div>
      )}
    </div>
  );
}
