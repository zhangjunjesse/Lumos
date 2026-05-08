'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 8000;

export interface XStatus {
  loggedIn: boolean;
  userId: string;
  screenName: string;
  name: string;
  builtinBrowserReady: boolean;
}

/** 镜像 use-goofish-auth 的简化版,X 是单账号无需多态。 */
export function useXAuth() {
  const [status, setStatus] = useState<XStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'login' | 'logout'>(null);
  const [actionMessage, setActionMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/x/auth/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as XStatus;
      setStatus(data);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'unknown error');
    }
  }, []);
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refreshRef.current(); };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => { void refreshRef.current(); }, POLL_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const login = useCallback(async (
    input: { mode: 'browser'; timeoutSecs?: number } | { mode: 'paste'; cookieString: string }
      = { mode: 'browser', timeoutSecs: 300 },
  ) => {
    setBusy('login');
    setActionMessage(null);
    try {
      const res = await fetch('/api/x/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.code || 'login_failed');
      }
      setActionMessage({ kind: 'ok', text: `已登录 X (${data.screenName ? `@${data.screenName}` : data.userId})` });
      await refresh();
      return true;
    } catch (err) {
      setActionMessage({ kind: 'error', text: err instanceof Error ? err.message : '登录失败' });
      return false;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    setBusy('logout');
    setActionMessage(null);
    try {
      const res = await fetch('/api/x/auth/logout', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'logout_failed');
      setActionMessage({ kind: 'ok', text: '已退出 X' });
      await refresh();
    } catch (err) {
      setActionMessage({ kind: 'error', text: err instanceof Error ? err.message : '退出失败' });
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  return { status, statusError, busy, actionMessage, refresh, login, logout };
}
