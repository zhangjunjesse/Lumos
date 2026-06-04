'use client';

// 重试合成:用当前图片服务商对 mockup 重新合成、覆盖原图。支持同时多张并发重试。
// 每张各自后台跑(fire-and-forget),记下各自旧图 url + 截止时间,一次轮询查全部:谁换图(新文件→url 变)/失败/超时就标完成。

import { useEffect, useRef, useState } from 'react';
import { etsyForgeApi, type MockupItem } from '../api-client';

const TIMEOUT_MS = 10 * 60 * 1000;

export function useMockupRetry(
  mockups: MockupItem[],
  setMockups: (m: MockupItem[]) => void,
  onMsg: (s: string | null) => void,
  onError: (s: string | null) => void,
) {
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const beforeUrls = useRef<Map<string, string | null>>(new Map()); // id → 重合成前旧图 url
  const deadlines = useRef<Map<string, number>>(new Map()); // id → 超时时刻

  const retry = (id: string) => {
    if (retryingIds.has(id)) return; // 这张已在重试中
    beforeUrls.current.set(id, mockups.find((m) => m.id === id)?.url ?? null);
    onError(null);
    onMsg(null);
    etsyForgeApi
      .retryMockup(id)
      .then(() => {
        deadlines.current.set(id, Date.now() + TIMEOUT_MS);
        setRetryingIds((s) => new Set(s).add(id));
      })
      .catch((e) => {
        beforeUrls.current.delete(id);
        onError(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(() => {
    if (retryingIds.size === 0) return;
    const t = setInterval(async () => {
      let fresh: MockupItem[];
      try {
        ({ mockups: fresh } = await etsyForgeApi.listMockups());
      } catch {
        return; // 轮询抖动忽略
      }
      const done: string[] = [];
      let failMsg = '';
      for (const id of retryingIds) {
        const cur = fresh.find((m) => m.id === id);
        const changed = cur && cur.url !== (beforeUrls.current.get(id) ?? null);
        const failed = cur?.status === 'failed';
        const timedOut = (deadlines.current.get(id) ?? 0) < Date.now();
        if (!cur || changed || failed || timedOut) {
          done.push(id);
          if (failed) failMsg = cur?.failure_reason || '重试合成失败';
        }
      }
      if (done.length === 0) return;
      setMockups(fresh);
      setRetryingIds((s) => {
        const n = new Set(s);
        for (const id of done) {
          n.delete(id);
          beforeUrls.current.delete(id);
          deadlines.current.delete(id);
        }
        return n;
      });
      if (failMsg) onError(failMsg);
      else onMsg('重试合成完成,已覆盖');
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryingIds]);

  return { retryingIds, retry };
}
