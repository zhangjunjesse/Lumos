'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 8000;

export interface GoofishAccount {
  accountUnb: string;
  unb: string;
  nick: string;
  tracknick: string;
  valid: boolean;
}

export interface GoofishStatus {
  installed: boolean;
  loggedIn: boolean;
  mcpEnabled: boolean;
  /**
   * QR-mode prerequisites (Playwright + Chromium ~150MB) installed.
   * Drives whether GoofishPanel prompts before running QR login.
   */
  qrReady: boolean;
  /** Per-account list. New multi-account UI iterates this. */
  accounts?: GoofishAccount[];
  /** Single-account back-compat fields = first valid account in `accounts`. */
  unb?: string;
  tracknick?: string;
  nick?: string;
  error?: string | null;
}

export type LoginMode =
  | { mode: 'qr'; timeoutSecs?: number }
  | { mode: 'browser'; browser?: string }
  | { mode: 'paste'; cookieString: string };

/**
 * Stateful glue between GoofishPanel and /api/goofish/auth/*.
 *
 * Owns the polled status snapshot + per-action busy/error state. Mirrors the
 * pattern in use-wechat-export so the two panels feel consistent.
 */
export function useGoofishAuth() {
  const [status, setStatus] = useState<GoofishStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'login' | 'logout' | 'install'>(null);
  const [actionMessage, setActionMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/goofish/auth/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as GoofishStatus;
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

  const login = useCallback(async (input: LoginMode) => {
    setBusy('login');
    setActionMessage(null);
    try {
      const res = await fetch('/api/goofish/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'login_failed');
      }
      setActionMessage({
        kind: 'ok',
        text: `已登录闲鱼 (unb=${data.unb})`,
      });
      await refresh();
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '登录失败',
      });
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const install = useCallback(async (scope: 'core' | 'qr'): Promise<boolean> => {
    setBusy('install');
    setActionMessage(null);
    try {
      const res = await fetch('/api/goofish/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'install_failed');
      }
      setActionMessage({
        kind: 'ok',
        text: scope === 'core' ? '已安装 goofish-cli' : '已下载浏览器组件',
      });
      await refresh();
      return true;
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '安装失败',
      });
      return false;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const logout = useCallback(async (account?: string) => {
    setBusy('logout');
    setActionMessage(null);
    try {
      const res = await fetch('/api/goofish/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(account ? { account } : {}),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'logout_failed');
      }
      setActionMessage({ kind: 'ok', text: account ? '已退出该账号' : '已退出全部账号' });
      await refresh();
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '退出失败',
      });
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  return {
    status,
    statusError,
    busy,
    actionMessage,
    refresh,
    login,
    logout,
    install,
  };
}
