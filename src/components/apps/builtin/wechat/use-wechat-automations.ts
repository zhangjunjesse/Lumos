'use client';

import * as React from 'react';

import type { Automation } from './relations-types';

interface ListResponse {
  automations?: Automation[];
  error?: string;
  message?: string;
}

interface ItemResponse {
  automation?: Automation;
  error?: string;
  message?: string;
}

export interface UseWeChatAutomations {
  automations: Automation[];
  loading: boolean;
  saving: boolean;
  canRetrySave: boolean;
  triggeringId: string | null;
  triggerMessage: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  retrySave: () => Promise<boolean>;
  create: (draft: Omit<Automation, 'id' | 'createdAt'>) => Promise<Automation | null>;
  update: (id: string, patch: Partial<Automation>) => void;
  remove: (id: string) => void;
  trigger: (id: string) => void;
}

export function useWeChatAutomations(): UseWeChatAutomations {
  const [automations, setAutomations] = React.useState<Automation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [failedSaveId, setFailedSaveId] = React.useState<string | null>(null);
  const [triggeringId, setTriggeringId] = React.useState<string | null>(null);
  const [triggerMessage, setTriggerMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const pendingRef = React.useRef<Map<string, Partial<Automation>>>(new Map());
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const failedPatchRef = React.useRef<{ id: string; patch: Partial<Automation> } | null>(null);
  // 乐观新建但服务端列表可能还没收录的 id：保护它不被「早于持久化发出、
  // 晚于 create 落 state 才 resolve」的 stale refresh 从 UI 抹掉。
  // 服务端列表一旦收录即清除（自确认，单客户端桌面端无 ghost）。
  const createdRef = React.useRef<Set<string>>(new Set());

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/apps/builtin/wechat/automations', { cache: 'no-store' });
      const json = (await readJson(res)) as ListResponse;
      const nextAutomations = json.automations;
      if (!res.ok || !Array.isArray(nextAutomations) || !nextAutomations.every(isAutomation)) {
        throw new Error(json.message ?? json.error ?? '自动化加载失败');
      }
      const hasSaveFailure = failedPatchRef.current !== null;
      setAutomations((prev) => mergeAutomations(prev, nextAutomations, pendingRef, failedPatchRef, createdRef));
      if (!hasSaveFailure) setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动化加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
  }, []);

  const clearPending = React.useCallback((id: string) => {
    const oldTimer = timersRef.current.get(id);
    if (oldTimer) clearTimeout(oldTimer);
    timersRef.current.delete(id);
    pendingRef.current.delete(id);
  }, []);

  const clearSaveFailure = React.useCallback(() => {
    failedPatchRef.current = null;
    setFailedSaveId(null);
  }, []);

  const flushPending = React.useCallback(async (id: string): Promise<boolean> => {
    const failedPatch = failedPatchRef.current?.id === id ? failedPatchRef.current.patch : null;
    const pendingPatch = pendingRef.current.get(id);
    const nextPatch = { ...(failedPatch ?? {}), ...(pendingPatch ?? {}) };
    if (!nextPatch || Object.keys(nextPatch).length === 0) return true;
    clearPending(id);
    if (failedPatch) clearSaveFailure();
    return savePatch(
      id,
      nextPatch,
      setAutomations,
      setSaving,
      setError,
      setFailedSaveId,
      failedPatchRef,
    );
  }, [clearPending, clearSaveFailure]);

  const retrySave = React.useCallback<UseWeChatAutomations['retrySave']>(async () => {
    const failed = failedPatchRef.current;
    if (!failed) return false;
    pendingRef.current.set(failed.id, failed.patch);
    clearSaveFailure();
    setError(null);
    const timer = timersRef.current.get(failed.id);
    if (timer) clearTimeout(timer);
    return flushPending(failed.id);
  }, [clearSaveFailure, flushPending]);

  const create = React.useCallback<UseWeChatAutomations['create']>(async (draft) => {
    setSaving(true);
    try {
      const res = await fetch('/api/apps/builtin/wechat/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = (await readJson(res)) as ItemResponse;
      const automation = json.automation;
      if (!res.ok || !isAutomation(automation)) {
        throw new Error(json.message ?? json.error ?? '创建失败');
      }
      createdRef.current.add(automation.id);
      setAutomations((prev) => replaceAutomation(prev, automation));
      if (!failedPatchRef.current) setError(null);
      return automation;
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const update = React.useCallback<UseWeChatAutomations['update']>((id, patch) => {
    const failedPatch = failedPatchRef.current?.id === id ? failedPatchRef.current.patch : null;
    if (failedPatch) clearSaveFailure();
    if (!failedPatchRef.current || failedPatch) setError(null);
    const optimisticPatch = { ...(failedPatch ?? {}), ...patch };
    setAutomations((prev) => prev.map((item) => (item.id === id ? { ...item, ...optimisticPatch } : item)));
    const previous = pendingRef.current.get(id) ?? {};
    pendingRef.current.set(id, { ...(failedPatch ?? {}), ...previous, ...patch });
    const oldTimer = timersRef.current.get(id);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
      const nextPatch = pendingRef.current.get(id);
      pendingRef.current.delete(id);
      timersRef.current.delete(id);
      if (!nextPatch || Object.keys(nextPatch).length === 0) return;
      void savePatch(
        id,
        nextPatch,
        setAutomations,
        setSaving,
        setError,
        setFailedSaveId,
        failedPatchRef,
      );
    }, 450);
    timersRef.current.set(id, timer);
  }, [clearSaveFailure]);

  const remove = React.useCallback<UseWeChatAutomations['remove']>((id) => {
    clearPending(id);
    createdRef.current.delete(id);
    if (failedPatchRef.current?.id === id) clearSaveFailure();
    setAutomations((prev) => prev.filter((item) => item.id !== id));
    setSaving(true);
    void fetch(`/api/apps/builtin/wechat/automations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(async (res) => {
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? '删除失败');
        }
        if (!failedPatchRef.current) setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '删除失败');
        void refresh();
      })
      .finally(() => setSaving(false));
  }, [clearPending, clearSaveFailure, refresh]);

  const trigger = React.useCallback<UseWeChatAutomations['trigger']>((id) => {
    if (triggeringId) {
      setTriggerMessage('已有自动化正在触发，请等当前任务进入运行记录后再试。');
      return;
    }
    setTriggeringId(id);
    setTriggerMessage(null);
    void (async () => {
      const flushed = await flushPending(id);
      if (!flushed) return;
      const res = await fetch(`/api/apps/builtin/wechat/automations/${encodeURIComponent(id)}`, { method: 'POST' });
      const json = (await readJson(res)) as ItemResponse;
      const automation = json.automation;
      if (!res.ok || !isAutomation(automation)) {
        throw new Error(json.message ?? json.error ?? '触发失败');
      }
      setAutomations((prev) => replaceAutomation(prev, automation));
      setTriggerMessage('已触发，执行记录会在调度详情里更新');
      if (!failedPatchRef.current) setError(null);
      void refresh();
    })()
      .catch((err) => {
        setError(err instanceof Error ? err.message : '触发失败');
        setTriggerMessage(null);
      })
      .finally(() => setTriggeringId(null));
  }, [flushPending, refresh, triggeringId]);

  return {
    automations,
    loading,
    saving,
    canRetrySave: failedSaveId !== null,
    triggeringId,
    triggerMessage,
    error,
    refresh,
    retrySave,
    create,
    update,
    remove,
    trigger,
  };
}

async function savePatch(
  id: string,
  patch: Partial<Automation>,
  setAutomations: React.Dispatch<React.SetStateAction<Automation[]>>,
  setSaving: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setFailedSaveId: React.Dispatch<React.SetStateAction<string | null>>,
  failedPatchRef: React.MutableRefObject<{ id: string; patch: Partial<Automation> } | null>,
): Promise<boolean> {
  setSaving(true);
  try {
    const res = await fetch('/api/apps/builtin/wechat/automations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, patch }),
    });
    const json = (await readJson(res)) as ItemResponse;
    const automation = json.automation;
    if (!res.ok || !isAutomation(automation)) {
      throw new Error(json.message ?? json.error ?? '保存失败');
    }
    setAutomations((prev) => replaceAutomation(prev, automation));
    if (failedPatchRef.current?.id === id) {
      setFailedSaveId(null);
      failedPatchRef.current = null;
    }
    if (!failedPatchRef.current) setError(null);
    return true;
  } catch (err) {
    setError(err instanceof Error ? err.message : '保存失败');
    const previousFailedPatch = failedPatchRef.current?.id === id ? failedPatchRef.current.patch : {};
    failedPatchRef.current = { id, patch: { ...previousFailedPatch, ...patch } };
    setFailedSaveId(id);
    return false;
  } finally {
    setSaving(false);
  }
}

export function mergeAutomations(
  prev: Automation[],
  serverAutomations: Automation[],
  pendingRef: React.MutableRefObject<Map<string, Partial<Automation>>>,
  failedPatchRef: React.MutableRefObject<{ id: string; patch: Partial<Automation> } | null>,
  createdRef: React.MutableRefObject<Set<string>>,
): Automation[] {
  const prevById = new Map(prev.map((automation) => [automation.id, automation]));
  const dirtyIds = new Set<string>([
    ...pendingRef.current.keys(),
    failedPatchRef.current?.id ?? '',
  ].filter(Boolean));
  const merged: Automation[] = [];

  for (const serverAutomation of serverAutomations) {
    // 服务端已收录 → 该乐观新建已确认，撤销保护（防 ghost）。
    createdRef.current.delete(serverAutomation.id);
    if (dirtyIds.has(serverAutomation.id) && prevById.has(serverAutomation.id)) {
      merged.push(prevById.get(serverAutomation.id)!);
      prevById.delete(serverAutomation.id);
      continue;
    }
    merged.push(serverAutomation);
    prevById.delete(serverAutomation.id);
  }

  // 仅在 prev 的项：dirty(未存的编辑) 或 刚乐观新建(服务端列表还没追上) 才保留，
  // 否则视为已在别处删除。create 漏了后者保护会导致新建项被 stale refresh 抹掉。
  for (const [id, automation] of prevById.entries()) {
    if (dirtyIds.has(id) || createdRef.current.has(id)) merged.push(automation);
  }

  return merged;
}

function replaceAutomation(list: Automation[], automation: Automation): Automation[] {
  const exists = list.some((item) => item.id === automation.id);
  if (!exists) return [automation, ...list];
  return list.map((item) => (item.id === automation.id ? automation : item));
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

function isAutomation(value: unknown): value is Automation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Automation>;
  return (
    typeof item.id === 'string'
    && typeof item.name === 'string'
    && (item.kind === 'reminder_once' || item.kind === 'reminder_recurring')
    && typeof item.cron === 'string'
    && typeof item.cronLabel === 'string'
    && typeof item.enabled === 'boolean'
    && typeof item.createdAt === 'number'
    && isAutomationAction(item.action)
  );
}

function isAutomationAction(value: unknown): value is Automation['action'] {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<Automation['action']>;
  return (
    typeof action.messageTemplate === 'string'
    && (
      action.kind === 'custom'
      || action.kind === 'wechat_summary'
      || (action.kind === 'remind_followup' && typeof action.followupId === 'string')
      || (action.kind === 'recap_person' && typeof action.personId === 'string')
    )
  );
}
