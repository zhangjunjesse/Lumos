'use client';

// 创作区会话管理：多会话(建/列/切/删) + 加载消息。复用全局 ChatSession(marker 区分)。
// 兼容旧单会话用户：localStorage 仍存「当前会话 id」,初始化时优先恢复它。

import { useCallback, useEffect, useState } from 'react';
import type { ChatSession, Message, MessagesResponse } from '@/types';
import { isIsolatedCreationSession } from '@/lib/chat/creation-session';

const STORAGE_KEY = 'lumos:etsy-creation-session';
const SESSION_ENDPOINT = '/api/apps/builtin/etsy-forge/creation/session';
const SESSIONS_ENDPOINT = '/api/apps/builtin/etsy-forge/creation/sessions';

export interface CreationSessionMeta {
  id: string;
  title: string;
  created_at: string;
}

export interface CreationSessionState {
  sessionId: string;
  model: string;
  providerId: string;
  workingDirectory: string;
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  error: string;
  sessions: CreationSessionMeta[];
  newSession: () => Promise<void>;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
}

export function useCreationSession(): CreationSessionState {
  const [sessions, setSessions] = useState<CreationSessionMeta[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [model, setModel] = useState('');
  const [providerId, setProviderId] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/chat/sessions/${id}/messages?limit=100`);
    if (!res.ok) return;
    const data: MessagesResponse = await res.json();
    setMessages(data.messages || []);
    setHasMore(data.hasMore ?? false);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch(SESSIONS_ENDPOINT);
      if (res.ok) setSessions(((await res.json()).sessions as CreationSessionMeta[]) || []);
    } catch {
      /* 列表刷新失败不致命，保持原列表 */
    }
  }, []);

  const fetchSession = useCallback(async (id: string): Promise<ChatSession | null> => {
    try {
      const res = await fetch(`/api/chat/sessions/${id}`);
      if (!res.ok) return null;
      const data: { session: ChatSession } = await res.json();
      return isIsolatedCreationSession(data.session) ? data.session : null;
    } catch {
      return null;
    }
  }, []);

  const createSession = useCallback(async (): Promise<ChatSession | null> => {
    const res = await fetch(SESSION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || '初始化创作区会话失败');
    }
    return ((await res.json()) as { session: ChatSession }).session;
  }, []);

  const openSession = useCallback(
    async (session: ChatSession) => {
      setSessionId(session.id);
      setModel(session.model || '');
      setProviderId(session.provider_id || '');
      setWorkingDirectory(session.working_directory || '');
      if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, session.id);
      await loadMessages(session.id);
    },
    [loadMessages],
  );

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError('');
      try {
        const listRes = await fetch(SESSIONS_ENDPOINT);
        const list: CreationSessionMeta[] = listRes.ok ? (await listRes.json()).sessions || [] : [];
        if (cancelled) return;
        setSessions(list);

        const cachedId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        let current: ChatSession | null = null;
        if (cachedId && list.some((x) => x.id === cachedId)) current = await fetchSession(cachedId);
        if (!current && list.length > 0) current = await fetchSession(list[0].id);
        if (!current) {
          current = await createSession();
          await refreshList();
        }
        if (cancelled) return;
        if (!current) {
          setError('初始化创作区会话失败');
          return;
        }
        await openSession(current);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '初始化创作区会话失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [fetchSession, createSession, openSession, refreshList]);

  // 生成在后台流式产出，定时刷新看新图。
  useEffect(() => {
    if (!sessionId) return;
    const t = window.setInterval(() => void loadMessages(sessionId), 4000);
    return () => window.clearInterval(t);
  }, [sessionId, loadMessages]);

  const newSession = useCallback(async () => {
    setError('');
    try {
      const s = await createSession();
      if (!s) return;
      await refreshList();
      await openSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : '新建会话失败');
    }
  }, [createSession, refreshList, openSession]);

  const switchSession = useCallback(
    (id: string) => {
      if (!id || id === sessionId) return;
      setMessages([]);
      setHasMore(false);
      void (async () => {
        const s = await fetchSession(id);
        if (s) await openSession(s);
      })();
    },
    [sessionId, fetchSession, openSession],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
        if (!res.ok) return;
        const remaining = sessions.filter((x) => x.id !== id);
        setSessions(remaining);
        if (id !== sessionId) return;
        const fallback = remaining.length > 0 ? await fetchSession(remaining[0].id) : await createSession();
        if (fallback) {
          if (remaining.length === 0) await refreshList();
          await openSession(fallback);
        }
      } catch {
        /* 删除失败：保持当前状态 */
      }
    },
    [sessions, sessionId, fetchSession, createSession, refreshList, openSession],
  );

  return {
    sessionId,
    model,
    providerId,
    workingDirectory,
    messages,
    hasMore,
    loading,
    error,
    sessions,
    newSession,
    switchSession,
    deleteSession,
  };
}
