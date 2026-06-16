'use client';

// 右下角浮层:产品开发的图片异步生成进度。轮询所有 running 任务，有就显示，没有自动隐藏。不挡手。
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { listingApi, type PhotoGenJobRow } from './listing-api';

export function PhotoJobsDock() {
  const [running, setRunning] = useState<PhotoGenJobRow[]>([]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { jobs } = await listingApi.listPhotoJobs();
        if (!stop) setRunning(jobs.filter((j) => j.status === 'running'));
      } catch {
        /* 忽略一轮 */
      }
    };
    void tick();
    const t = setInterval(() => { if (!stop) void tick(); }, 4000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  if (running.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-60 rounded-lg border bg-card p-3 shadow-lg">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-fuchsia-500" />
        生成中 · {running.length}
      </div>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {running.slice(0, 6).map((j) => (
          <li key={j.id} className="truncate">{j.label}</li>
        ))}
        {running.length > 6 && <li>…还有 {running.length - 6} 个</li>}
      </ul>
    </div>
  );
}
