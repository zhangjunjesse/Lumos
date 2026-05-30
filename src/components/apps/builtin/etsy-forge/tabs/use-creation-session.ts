'use client';

// 创作区会话管理：建/恢复隔离创作会话 + 加载消息。照「资料库对话」那套，抽成 hook 给 ChatView + 仓库共用。

import { useCallback, useEffect, useState } from 'react';
import type { ChatSession, Message, MessagesResponse } from '@/types';
import { isIsolatedCreationSession } from '@/lib/chat/creation-session';

const STORAGE_KEY = 'lumos:etsy-creation-session';
const SESSION_ENDPOINT = '/api/apps/builtin/etsy-forge/creation/session';

export interface CreationSessionState {
  sessionId: string;
  model: string;
  providerId: string;
  workingDirectory: string;
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  error: string;
}

export function useCreationSession(): CreationSessionState {
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

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError('');
      let next: ChatSession | null = null;
      const cachedId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (cachedId) {
        try {
          const res = await fetch(`/api/chat/sessions/${cachedId}`);
          if (res.ok) {
            const data: { session: ChatSession } = await res.json();
            if (isIsolatedCreationSession(data.session)) next = data.session;
            else if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
          } else if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
        } catch {
          if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
        }
      }
      if (!next) {
        try {
          const res = await fetch(SESSION_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || '初始化创作区会话失败');
          }
          const data: { session: ChatSession } = await res.json();
          next = data.session;
          if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, data.session.id);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : '初始化创作区会话失败');
            setLoading(false);
          }
          return;
        }
      }
      if (!next || cancelled) return;
      setSessionId(next.id);
      setModel(next.model || '');
      setProviderId(next.provider_id || '');
      setWorkingDirectory(next.working_directory || '');
      await loadMessages(next.id);
      if (!cancelled) setLoading(false);
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [loadMessages]);

  // 生成在后台流式产出，定时刷新看新图（同资料库做法）。
  useEffect(() => {
    if (!sessionId) return;
    const t = window.setInterval(() => void loadMessages(sessionId), 4000);
    return () => window.clearInterval(t);
  }, [sessionId, loadMessages]);

  return { sessionId, model, providerId, workingDirectory, messages, hasMore, loading, error };
}
