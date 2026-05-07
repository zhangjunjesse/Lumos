'use client';

import * as React from 'react';

import type { WeChatTodo } from '@/lib/wechat-assistant/ai-types';

import type {
  Followup,
  FollowupStatus,
  FollowupType,
  SuggestedFollowup,
} from './relations-types';
import { displayWechatName, safeSanitizedWechatText } from './display-helpers';

interface TodosResponse {
  todos: WeChatTodo[];
  error?: string;
  message?: string;
}

interface TodoResponse {
  todo: WeChatTodo;
  error?: string;
  message?: string;
}

type TodoPatch = Partial<Pick<
  WeChatTodo,
  'text' | 'summary' | 'nextStep' | 'followupType' | 'dueAt' | 'remindAt' | 'involvedWxids'
>>;

export interface UseWeChatFollowups {
  followups: Followup[];
  suggested: SuggestedFollowup[];
  loading: boolean;
  saving: boolean;
  canRetrySave: boolean;
  analyzing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  retrySave: () => Promise<boolean>;
  runAnalysis: () => Promise<void>;
  createFollowup: (draft: Omit<Followup, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateFollowup: (id: string, patch: Partial<Followup>) => void;
  deleteFollowup: (id: string) => void;
  acceptSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;
}

export function useWeChatFollowups(): UseWeChatFollowups {
  const [todos, setTodos] = React.useState<WeChatTodo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [failedSaveId, setFailedSaveId] = React.useState<string | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pendingPatchRef = React.useRef<Map<string, TodoPatch>>(new Map());
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const failedPatchRef = React.useRef<{ id: string; patch: TodoPatch } | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/apps/builtin/wechat/todos', { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as Partial<TodosResponse>;
      if (!res.ok || !Array.isArray(json.todos)) {
        throw new Error(json.message ?? json.error ?? '跟进加载失败');
      }
      const nextTodos = json.todos;
      const hasSaveFailure = failedPatchRef.current !== null;
      setTodos((prev) => mergeTodos(prev, nextTodos, pendingPatchRef, failedPatchRef));
      if (!hasSaveFailure) setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '跟进加载失败');
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
    pendingPatchRef.current.delete(id);
  }, []);

  const clearSaveFailure = React.useCallback(() => {
    failedPatchRef.current = null;
    setFailedSaveId(null);
  }, []);

  const flushPending = React.useCallback(async (id: string): Promise<boolean> => {
    const failedPatch = failedPatchRef.current?.id === id ? failedPatchRef.current.patch : null;
    const pendingPatch = pendingPatchRef.current.get(id);
    const nextPatch = { ...(failedPatch ?? {}), ...(pendingPatch ?? {}) };
    if (!nextPatch || Object.keys(nextPatch).length === 0) return true;
    clearPending(id);
    if (failedPatch) clearSaveFailure();
    return savePatch(
      id,
      nextPatch,
      setTodos,
      setSaving,
      setError,
      setFailedSaveId,
      failedPatchRef,
    );
  }, [clearPending, clearSaveFailure]);

  const retrySave = React.useCallback<UseWeChatFollowups['retrySave']>(async () => {
    const failed = failedPatchRef.current;
    if (!failed) return false;
    pendingPatchRef.current.set(failed.id, failed.patch);
    clearSaveFailure();
    setError(null);
    const timer = timersRef.current.get(failed.id);
    if (timer) clearTimeout(timer);
    return flushPending(failed.id);
  }, [clearSaveFailure, flushPending]);

  const sendAction = React.useCallback(async (
    id: string,
    action: 'confirm' | 'start' | 'done' | 'dismiss' | 'reopen',
  ) => {
    const flushed = await flushPending(id);
    if (!flushed) return;
    setSaving(true);
    try {
      const res = await fetch('/api/apps/builtin/wechat/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'action', id, action }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<TodoResponse>;
      if (!res.ok || !json.todo) throw new Error(json.message ?? json.error ?? '跟进保存失败');
      const nextTodo = json.todo;
      setTodos((prev) => replaceTodo(prev, nextTodo));
      if (failedPatchRef.current?.id === id) clearSaveFailure();
      if (!failedPatchRef.current) setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '跟进保存失败');
      void refresh();
    } finally {
      setSaving(false);
    }
  }, [clearSaveFailure, flushPending, refresh]);

  const queuePatch = React.useCallback((id: string, patch: TodoPatch) => {
    const previous = pendingPatchRef.current.get(id) ?? {};
    pendingPatchRef.current.set(id, { ...previous, ...patch });
    const oldTimer = timersRef.current.get(id);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
      const nextPatch = pendingPatchRef.current.get(id);
      pendingPatchRef.current.delete(id);
      timersRef.current.delete(id);
      if (!nextPatch || Object.keys(nextPatch).length === 0) return;
      void savePatch(
        id,
        nextPatch,
        setTodos,
        setSaving,
        setError,
        setFailedSaveId,
        failedPatchRef,
      );
    }, 450);
    timersRef.current.set(id, timer);
  }, []);

  const createFollowup = React.useCallback<UseWeChatFollowups['createFollowup']>((draft) => {
    setSaving(true);
    void fetch('/api/apps/builtin/wechat/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'manual',
        text: draft.title,
        sourceWxid: draft.involvedPersonIds[0] ?? null,
        involvedWxids: draft.involvedPersonIds,
        summary: draft.summary,
        nextStep: draft.nextStep,
        followupType: draft.type,
        byWhenText: draft.nextStep,
        dueAt: draft.dueAt ?? null,
      }),
      })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as Partial<TodoResponse>;
        if (!res.ok || !json.todo) throw new Error(json.message ?? json.error ?? '创建失败');
        const nextTodo = json.todo;
        setTodos((prev) => replaceTodo(prev, nextTodo));
        if (!failedPatchRef.current) setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '创建失败');
      })
      .finally(() => setSaving(false));
  }, []);

  const updateFollowup = React.useCallback<UseWeChatFollowups['updateFollowup']>((id, patch) => {
    const failedPatch = failedPatchRef.current?.id === id ? failedPatchRef.current.patch : null;
    if (failedPatch) clearSaveFailure();
    if (!failedPatchRef.current || failedPatch) setError(null);
    const todoPatch = followupPatchToTodoPatch(patch);
    const nextPatch = { ...(failedPatch ?? {}), ...todoPatch };
    setTodos((prev) => prev.map((todo) => (
      todo.id === id ? applyTodoPatch(todo, nextPatch, patch.status) : todo
    )));
    if (Object.keys(nextPatch).length > 0) queuePatch(id, nextPatch);
    if (patch.status) {
      const action = statusToAction(patch.status);
      void sendAction(id, action);
    }
  }, [clearSaveFailure, queuePatch, sendAction]);

  const deleteFollowup = React.useCallback<UseWeChatFollowups['deleteFollowup']>((id) => {
    clearPending(id);
    if (failedPatchRef.current?.id === id) clearSaveFailure();
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
    setSaving(true);
    void fetch(`/api/apps/builtin/wechat/todos/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(async (res) => {
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          throw new Error(json.message ?? json.error ?? '删除失败');
        }
        if (!failedPatchRef.current) setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '删除失败');
        void refresh();
      })
      .finally(() => setSaving(false));
  }, [clearPending, clearSaveFailure, refresh]);

  const runAnalysis = React.useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch('/api/apps/builtin/wechat/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(json.message ?? json.error ?? '分析失败');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setAnalyzing(false);
    }
  }, [refresh]);

  const followups = React.useMemo(
    () => todos.filter(isVisibleFollowupTodo).map(todoToFollowup),
    [todos],
  );
  const suggested = React.useMemo(
    () => todos.filter((todo) => todo.status === 'suggested').map(todoToSuggestion),
    [todos],
  );

  return {
    followups,
    suggested,
    loading,
    saving,
    canRetrySave: failedSaveId !== null,
    analyzing,
    error,
    refresh,
    retrySave,
    runAnalysis,
    createFollowup,
    updateFollowup,
    deleteFollowup,
    acceptSuggestion: (id) => void sendAction(id, 'confirm'),
    dismissSuggestion: (id) => void sendAction(id, 'dismiss'),
  };
}

function todoToFollowup(todo: WeChatTodo): Followup {
  const type = todo.followupType ?? inferFollowupType(todo);
  const summary = todo.summary ?? todo.sourceText ?? sourceSummary(todo);
  const nextStep = todo.nextStep ?? todo.byWhenText ?? todo.text;
  const status: FollowupStatus =
    todo.status === 'done'
      ? 'done'
      : todo.status === 'in_progress'
        ? 'in_progress'
        : todo.status === 'dismissed'
          ? 'archived'
          : 'open';
  return {
    id: todo.id,
    title: todoDisplayText(todo, todo.text, '微信待跟进事项'),
    type,
    involvedPersonIds: todo.involvedWxids,
    summary: todoDisplayText(todo, summary, '来自微信消息的待跟进线索'),
    nextStep: todoDisplayText(todo, nextStep, '查看微信原文后处理'),
    status,
    createdAt: todo.createdAt,
    updatedAt: todo.doneAt ?? todo.confirmedAt ?? todo.createdAt,
    dueAt: todo.dueAt ?? undefined,
    dialogueRefs: todo.sourceText
      ? [{
          ts: todo.createdAt,
          who: dialogueWho(todo),
          text: todoDisplayText(todo, todo.sourceText, '暂无原文'),
        }]
      : [],
    automationIds: [],
  };
}

function isVisibleFollowupTodo(todo: WeChatTodo): boolean {
  if (todo.status === 'suggested') return false;
  if (todo.status === 'dismissed') {
    return todo.confirmedAt !== null || todo.source === 'manual';
  }
  return true;
}

function todoToSuggestion(todo: WeChatTodo): SuggestedFollowup {
  return {
    id: todo.id,
    draftTitle: safeSanitizedWechatText(todo.text, '微信待跟进事项'),
    draftType: todo.followupType ?? inferFollowupType(todo),
    reason: safeSanitizedWechatText(todo.summary ?? sourceSummary(todo), '来自微信消息的待跟进线索'),
    involvedPersonIds: todo.involvedWxids,
    evidenceText: safeSanitizedWechatText(todo.sourceText ?? todo.byWhenText ?? todo.text, '暂无原文'),
    sourceDisplay: todo.sourceDisplay,
    sourceWxid: todo.sourceWxid,
    sourceSpeaker: todo.source === 'self' ? 'me' : 'them',
    sourceSpeakerName: todo.sourceSenderDisplay,
  };
}

function followupPatchToTodoPatch(patch: Partial<Followup>): TodoPatch {
  const out: TodoPatch = {};
  if (patch.title !== undefined) out.text = patch.title;
  if (patch.summary !== undefined) out.summary = patch.summary;
  if (patch.nextStep !== undefined) {
    out.nextStep = patch.nextStep;
  }
  if (patch.type !== undefined) out.followupType = patch.type;
  if (patch.dueAt !== undefined) out.dueAt = patch.dueAt ?? null;
  if (patch.involvedPersonIds !== undefined) out.involvedWxids = patch.involvedPersonIds;
  return out;
}

function applyTodoPatch(
  todo: WeChatTodo,
  patch: TodoPatch,
  status?: FollowupStatus,
): WeChatTodo {
  const nextStatus = status
    ? status === 'done'
      ? 'done'
      : status === 'archived'
        ? 'dismissed'
        : status === 'in_progress'
          ? 'in_progress'
          : 'open'
    : todo.status;
  return {
    ...todo,
    text: patch.text ?? todo.text,
    summary: patch.summary === undefined ? todo.summary : patch.summary,
    nextStep: patch.nextStep === undefined ? todo.nextStep : patch.nextStep,
    byWhenText: patch.nextStep === undefined ? todo.byWhenText : patch.nextStep,
    followupType: patch.followupType === undefined ? todo.followupType : patch.followupType,
    dueAt: patch.dueAt === undefined ? todo.dueAt : patch.dueAt,
    remindAt: patch.remindAt === undefined ? todo.remindAt : patch.remindAt,
    involvedWxids: patch.involvedWxids === undefined ? todo.involvedWxids : patch.involvedWxids,
    sourceWxid: patch.involvedWxids === undefined ? todo.sourceWxid : (patch.involvedWxids[0] ?? null),
    status: nextStatus,
  };
}

async function savePatch(
  id: string,
  patch: TodoPatch,
  setTodos: React.Dispatch<React.SetStateAction<WeChatTodo[]>>,
  setSaving: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setFailedSaveId: React.Dispatch<React.SetStateAction<string | null>>,
  failedPatchRef: React.MutableRefObject<{ id: string; patch: TodoPatch } | null>,
): Promise<boolean> {
  setSaving(true);
  try {
    const res = await fetch(`/api/apps/builtin/wechat/todos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<TodoResponse>;
    if (!res.ok || !json.todo) throw new Error(json.message ?? json.error ?? '保存失败');
    const nextTodo = json.todo;
    setTodos((prev) => replaceTodo(prev, nextTodo));
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

function mergeTodos(
  prev: WeChatTodo[],
  serverTodos: WeChatTodo[],
  pendingPatchRef: React.MutableRefObject<Map<string, TodoPatch>>,
  failedPatchRef: React.MutableRefObject<{ id: string; patch: TodoPatch } | null>,
): WeChatTodo[] {
  const prevById = new Map(prev.map((todo) => [todo.id, todo]));
  const dirtyIds = new Set<string>([
    ...pendingPatchRef.current.keys(),
    failedPatchRef.current?.id ?? '',
  ].filter(Boolean));
  const merged: WeChatTodo[] = [];

  for (const serverTodo of serverTodos) {
    if (dirtyIds.has(serverTodo.id) && prevById.has(serverTodo.id)) {
      merged.push(prevById.get(serverTodo.id)!);
      prevById.delete(serverTodo.id);
      continue;
    }
    merged.push(serverTodo);
    prevById.delete(serverTodo.id);
  }

  for (const [id, todo] of prevById.entries()) {
    if (dirtyIds.has(id)) merged.push(todo);
  }

  return merged;
}

function replaceTodo(list: WeChatTodo[], todo: WeChatTodo): WeChatTodo[] {
  const exists = list.some((item) => item.id === todo.id);
  if (!exists) return [todo, ...list];
  return list.map((item) => (item.id === todo.id ? todo : item));
}

function statusToAction(status: FollowupStatus): 'confirm' | 'start' | 'done' | 'dismiss' | 'reopen' {
  if (status === 'done') return 'done';
  if (status === 'archived') return 'dismiss';
  if (status === 'in_progress') return 'start';
  return 'reopen';
}

function inferFollowupType(todo: WeChatTodo): FollowupType {
  if (todo.source === 'self') return 'commitment';
  if (todo.source === 'other') return 'reply';
  return 'other';
}

function sourceSummary(todo: WeChatTodo): string {
  if (todo.source === 'manual') return '手动创建的跟进事项';
  const source = sourceDisplayName(todo);
  if (source) return `来自「${source}」的微信消息`;
  return '微信消息识别出的跟进事项';
}

function dialogueWho(todo: WeChatTodo): string {
  const source = sourceDisplayName(todo);
  const sender = todo.sourceSenderDisplay
    ? displayWechatName(todo.sourceSenderDisplay, null, { contactFallback: '群成员' })
    : null;
  if (sender && source) {
    return `${source} · ${sender}`;
  }
  return source ?? sender ?? '微信消息';
}

function sourceDisplayName(todo: WeChatTodo): string | null {
  if (!todo.sourceDisplay && !todo.sourceWxid) return null;
  return displayWechatName(todo.sourceDisplay, todo.sourceWxid, {
    groupFallback: '微信群聊',
    contactFallback: '微信联系人',
  });
}

function todoDisplayText(todo: WeChatTodo, value: string | null | undefined, fallback: string): string {
  const text = value?.trim() ?? '';
  if (todo.source === 'manual') return text || fallback;
  return safeSanitizedWechatText(text, fallback);
}
