'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// 主 Agent 会话「跨睡眠日」自动接管。
// 用户开着当天会话的页面挂到次日睡眠时间后，后端已归档旧会话并建当日新会话，
// 但这个已打开的页面不会自己跳过去 —— 于是新会话空着、旧(已归档)会话被继续写大。
// 这个 watcher 只在「打开的就是实时会话」时盯着切日，发生切日就 replace 到新会话；
// 用户从历史面板主动点开的旧归档会话不在监视内，不会被拽走。

const POLL_INTERVAL_MS = 60_000;

function sessionIdFromPath(pathname: string): string {
  if (!pathname.startsWith('/main-agent/')) return '';
  return pathname.replace('/main-agent/', '').split('/')[0];
}

export function MainAgentRolloverWatcher() {
  const pathname = usePathname() || '';
  const router = useRouter();
  const openId = sessionIdFromPath(pathname);
  // null = 尚未判定打开的是否实时会话；true/false = 已判定
  const watchingRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!openId) return;
    watchingRef.current = null;
    let cancelled = false;

    const resolveCurrent = async (): Promise<string> => {
      const res = await fetch('/api/main-agent/current', { cache: 'no-store' });
      if (!res.ok) return '';
      const data = (await res.json()) as { sessionId?: string | null };
      return data.sessionId || '';
    };

    const tick = async () => {
      let currentId = '';
      try {
        currentId = await resolveCurrent();
      } catch {
        return; // 网络抖动忽略，下个周期再试
      }
      if (cancelled || !currentId) return;
      if (watchingRef.current === null) {
        // 首次判定：只有打开的就是当日实时会话才进入监视，历史会话不接管
        watchingRef.current = currentId === openId;
        return;
      }
      if (watchingRef.current && currentId !== openId) {
        watchingRef.current = false; // 跳转前收口，避免重复 replace
        router.replace(`/main-agent/${currentId}`);
      }
    };

    void tick();
    const timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [openId, router]);

  return null;
}
