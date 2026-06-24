'use client';

import { useCallback, useState } from 'react';
import type { ClaudeLocalAuthStatus, SavedConfig } from './shared';
import { isLocalAuthAnthropic } from './shared';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export interface LocalAuthState {
  statuses: Record<string, ClaudeLocalAuthStatus>;
  loadingId: string | null;
  actionMessage: string;
  actionError: string;
  refresh: (configId: string) => Promise<void>;
  startLogin: (configId: string) => Promise<void>;
  primeFromList: (providers: SavedConfig[]) => Promise<void>;
  clearMessages: () => void;
}

async function fetchStatus(configId: string, forceRefresh = false): Promise<ClaudeLocalAuthStatus> {
  // forceRefresh：服务端绕过内存缓存重探（cache:'no-store' 只挡浏览器，绕不过服务端缓存）。
  const url = `/api/providers/${configId}/auth/status${forceRefresh ? '?refresh=1' : ''}`;
  const res = await fetch(url, { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as ClaudeLocalAuthStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || '读取 Claude 本地登录状态失败');
  return data;
}

export function useLocalAuth(): LocalAuthState {
  const [statuses, setStatuses] = useState<Record<string, ClaudeLocalAuthStatus>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');

  const syncStatus = useCallback(async (configId: string): Promise<ClaudeLocalAuthStatus> => {
    setLoadingId(configId);
    try {
      const status = await fetchStatus(configId, true);
      setStatuses((prev) => ({ ...prev, [configId]: status }));
      return status;
    } catch (error) {
      const fallback: ClaudeLocalAuthStatus = {
        available: true,
        authenticated: false,
        status: 'error',
        configDir: null,
        error: error instanceof Error ? error.message : '读取 Claude 本地登录状态失败',
      };
      setStatuses((prev) => ({ ...prev, [configId]: fallback }));
      throw error;
    } finally {
      setLoadingId((cur) => (cur === configId ? null : cur));
    }
  }, []);

  const refresh = useCallback(async (configId: string) => {
    setActionMessage('');
    setActionError('');
    try {
      const status = await syncStatus(configId);
      if (status.authenticated) {
        setActionMessage('Claude 本地登录可用');
        return;
      }
      if (status.error) {
        setActionError(status.error);
        return;
      }
      setActionMessage('Claude 本地登录未完成或已失效');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '读取 Claude 本地登录状态失败');
    }
  }, [syncStatus]);

  const pollUntilDone = useCallback(async (configId: string) => {
    const startedAt = Date.now();
    let last: ClaudeLocalAuthStatus | null = null;
    let lastErr: Error | null = null;
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const status = await fetchStatus(configId, true);
        setStatuses((prev) => ({ ...prev, [configId]: status }));
        last = status;
        if (status.authenticated) return status;
      } catch (error) {
        lastErr = error instanceof Error ? error : new Error('读取 Claude 本地登录状态失败');
      }
    }
    if (last) return last;
    if (lastErr) throw lastErr;
    return null;
  }, []);

  const startLogin = useCallback(async (configId: string) => {
    setLoadingId(configId);
    setActionMessage('');
    setActionError('');
    try {
      const res = await fetch(`/api/providers/${configId}/auth/login`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || '启动 Claude 本地登录流程失败');
      setActionMessage(data.message || '已打开 Claude 登录终端，请在浏览器完成授权');

      const finalStatus = await pollUntilDone(configId);
      if (finalStatus?.authenticated) {
        setActionError('');
        setActionMessage('Claude 本地登录已完成，可关闭终端窗口。');
        return;
      }
      if (finalStatus?.status === 'missing') {
        setActionMessage('');
        setActionError(finalStatus.error || '尚未检测到 Claude 登录完成。请确认终端里执行的是 /login，并在浏览器完成授权。');
        return;
      }
      if (finalStatus?.status === 'error') {
        setActionMessage('');
        setActionError(finalStatus.error || 'Claude 本地登录状态检测失败');
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '启动 Claude 本地登录流程失败');
    } finally {
      setLoadingId((cur) => (cur === configId ? null : cur));
    }
  }, [pollUntilDone]);

  const primeFromList = useCallback(async (providers: SavedConfig[]) => {
    const localAuthProviders = providers.filter(isLocalAuthAnthropic);
    if (localAuthProviders.length === 0) {
      setStatuses({});
      return;
    }
    const results = await Promise.all(localAuthProviders.map(async (p) => {
      try {
        return [p.id, await fetchStatus(p.id)] as const;
      } catch (error) {
        return [p.id, {
          available: true,
          authenticated: false,
          status: 'error' as const,
          configDir: null,
          error: error instanceof Error ? error.message : '读取 Claude 本地登录状态失败',
        }] as const;
      }
    }));
    setStatuses(Object.fromEntries(results));
  }, []);

  const clearMessages = useCallback(() => {
    setActionMessage('');
    setActionError('');
  }, []);

  return { statuses, loadingId, actionMessage, actionError, refresh, startLogin, primeFromList, clearMessages };
}

export function getLocalAuthBadge(status: ClaudeLocalAuthStatus | undefined): {
  label: string;
  className: string;
} {
  if (!status) {
    return { label: '等待检测', className: 'bg-muted text-muted-foreground' };
  }
  if (status.authenticated) {
    return {
      label: '已登录',
      className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    };
  }
  if (status.status === 'missing') {
    return {
      label: '未登录/已失效',
      className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    };
  }
  return { label: '检测失败', className: 'bg-destructive/10 text-destructive' };
}
