'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtractProgressEvent, WeChatExportStatus } from './types';

const POLL_MS = 4000;

/**
 * Stateful glue between the panel UI and /api/wechat-export/*.
 *
 * Owns:
 *   - the `status` snapshot (re-fetched on focus + every 4s while open)
 *   - consent / toggle / SSE-driven key extraction
 *   - per-action loading + error state for the panel
 */
export function useWeChatExport() {
  const [status, setStatus] = useState<WeChatExportStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'consent' | 'enable' | 'disable' | 'uninstall' | 'extract' | 'resign' | 'path' | 'reset-key'>(null);
  const [busyMessage, setBusyMessage] = useState<string>('');
  const [extractProgress, setExtractProgress] = useState<ExtractProgressEvent | null>(null);
  const [extractKeys, setExtractKeys] = useState<number>(0);
  const [actionMessage, setActionMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/wechat-export/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as WeChatExportStatus;
      setStatus(data);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'unknown error');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const acceptConsent = useCallback(async () => {
    if (!status?.consent) return;
    setBusy('consent');
    setActionMessage(null);
    try {
      const res = await fetch('/api/wechat-export/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'accept',
          acknowledgedVersion: status.consent.version,
          acknowledgedHash: status.consent.hash,
          acceptedRiskBox: true,
          acceptedScopeBox: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'consent_failed');
      setActionMessage({ kind: 'ok', text: '已接受免责声明。' });
      await refresh();
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '操作失败',
      });
    } finally {
      setBusy(null);
    }
  }, [status?.consent, refresh]);

  const toggle = useCallback(async (action: 'enable' | 'disable' | 'uninstall') => {
    setBusy(action);
    setActionMessage(null);
    try {
      const res = await fetch('/api/wechat-export/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || 'toggle_failed');
      const text = action === 'enable'
        ? '微信导出已启用。'
        : action === 'disable'
          ? '微信导出已暂停 (密钥保留)。'
          : '微信导出已完全卸载,密钥已删除。';
      setActionMessage({ kind: 'ok', text });
      await refresh();
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '操作失败',
      });
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  // #40:切换微信账号/升级后清旧密钥,回到"未取密钥"状态重新绑定当前账号。
  const resetKey = useCallback(async () => {
    setBusy('reset-key');
    setActionMessage(null);
    try {
      const res = await fetch('/api/wechat-export/reset-key', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || 'reset_failed');
      setActionMessage({ kind: 'ok', text: '已清除旧密钥。请退出微信读取保护后,重新获取当前账号的密钥。' });
      await refresh();
    } catch (err) {
      setActionMessage({ kind: 'error', text: err instanceof Error ? err.message : '重置失败' });
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const resignWeChat = useCallback(async (): Promise<boolean> => {
    setBusy('resign');
    setBusyMessage('正在准备临时放开微信读取保护…');
    setActionMessage(null);
    try {
      const res = await fetch('/api/wechat-export/resign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || 'resign_failed');
      setActionMessage({
        kind: 'ok',
        text: data?.message || '已临时放开微信读取保护。请等微信进入主界面后重新提取密钥。',
      });
      await refresh();
      return true;
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '临时放开失败',
      });
      return false;
    } finally {
      setBusy(null);
      setBusyMessage('');
    }
  }, [refresh]);

  const startExtract = useCallback(async (): Promise<boolean> => {
    setBusy('extract');
    setBusyMessage('准备扫描微信进程内存…');
    setExtractProgress(null);
    setExtractKeys(0);
    setActionMessage(null);

    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    let completed = false;
    try {
      const res = await fetch('/api/wechat-export/extract-key', {
        method: 'POST',
        headers: { 'Accept': 'text/event-stream' },
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || `start failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const eventLine = block.split('\n').find(l => l.startsWith('event: '));
          const dataLine = block.split('\n').find(l => l.startsWith('data: '));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));
          if (event === 'progress') {
            setExtractProgress(data as ExtractProgressEvent);
            if ((data as ExtractProgressEvent).phase === 'found') {
              setExtractKeys((n) => n + 1);
            }
            setBusyMessage((data as ExtractProgressEvent).message || busyMessage);
          } else if (event === 'done') {
            completed = true;
            setBusyMessage(`已恢复 ${data.keysFound ?? 0} 个数据库密钥。`);
            setActionMessage({
              kind: 'ok',
              text: `密钥提取完成,共恢复 ${data.keysFound ?? 0} 个数据库密钥。`,
            });
          } else if (event === 'error') {
            throw new Error(data?.message || '提取失败');
          }
        }
      }
      await refresh();
      return completed;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return false;
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '提取失败',
      });
      return false;
    } finally {
      setBusy(null);
      setBusyMessage('');
    }
  }, [refresh, busyMessage]);

  const cancelExtract = useCallback(() => {
    abortRef.current?.abort();
    setBusy(null);
    setBusyMessage('');
  }, []);

  const saveWindowsPath = useCallback(async (kind: 'wechatExe' | 'dataDir', selectedPath: string) => {
    const normalized = selectedPath.trim();
    if (!normalized) {
      setActionMessage({ kind: 'error', text: '请先选择或输入路径。' });
      return false;
    }
    setBusy('path');
    setActionMessage(null);
    try {
      const res = await fetch('/api/wechat-export/windows-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, path: normalized }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || 'save_path_failed');
      setActionMessage({ kind: 'ok', text: data?.message || '路径已保存。' });
      await refresh();
      return true;
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '路径保存失败',
      });
      return false;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  /**
   * 直接绑定某个微信号。用户从检测到的账号里点一个即可 —— 不必知道微信把数据
   * 放在哪、该选哪一层目录。这是自动检测猜错时最省事的纠正手段。
   */
  const bindAccount = useCallback(async (wxid: string) => {
    setBusy('path');
    setActionMessage(null);
    try {
      const res = await fetch('/api/wechat-export/bind-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wxid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || 'bind_failed');
      setActionMessage({ kind: 'ok', text: data?.message || `已绑定 ${wxid}。` });
      await refresh();
      return true;
    } catch (err) {
      setActionMessage({ kind: 'error', text: err instanceof Error ? err.message : '绑定失败' });
      return false;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  /**
   * 清空微信配置,回到未绑定状态。allAccounts=true 时连历史账号的聊天镜像一并删。
   * 这是不设前置条件的兜底出口 —— 任何时候都能点,不依赖 Lumos 是否"检测到"异常。
   */
  const resetAll = useCallback(async (allAccounts = false) => {
    setBusy('reset-key');
    setActionMessage(null);
    try {
      const res = await fetch('/api/wechat-export/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all', allAccounts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || 'reset_failed');
      const cleared = Array.isArray(data?.clearedMirrors) ? data.clearedMirrors.length : 0;
      setActionMessage({
        kind: 'ok',
        text: cleared > 0
          ? `已清空微信配置和 ${cleared} 个账号的本地聊天数据,请重新取密钥。`
          : '已清空微信配置,请重新取密钥。',
      });
      await refresh();
      return true;
    } catch (err) {
      setActionMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : '清空失败',
      });
      return false;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  return {
    status,
    statusError,
    busy,
    busyMessage,
    extractProgress,
    extractKeys,
    actionMessage,
    refresh,
    acceptConsent,
    toggle,
    resetKey,
    resetAll,
    bindAccount,
    resignWeChat,
    startExtract,
    cancelExtract,
    saveWindowsPath,
  };
}
