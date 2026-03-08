"use client";

import { useCallback, useEffect, useState } from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading, Sparkles } from "@hugeicons/core-free-icons";
import type { ChatSession, Message, MessagesResponse } from '@/types';
import { ChatView } from '@/components/chat/ChatView';
import { useTranslation } from '@/hooks/useTranslation';

const STORAGE_KEY = 'lumos:extension-builder-session';

export function ExtensionBuilderPanel() {
  const { t } = useTranslation();
  const [sessionId, setSessionId] = useState('');
  const [sessionModel, setSessionModel] = useState('');
  const [sessionProviderId, setSessionProviderId] = useState('');
  const [sessionMode, setSessionMode] = useState('code');
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

      let id = '';
      const cached = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (cached) {
        try {
          const res = await fetch(`/api/chat/sessions/${cached}`);
          if (res.ok) {
            const data: { session: ChatSession } = await res.json();
            id = data.session.id;
            setSessionModel(data.session.model || '');
            setSessionProviderId(data.session.provider_id || '');
            setSessionMode(data.session.mode || 'code');
          } else {
            localStorage.removeItem(STORAGE_KEY);
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      if (!id) {
        try {
          const res = await fetch('/api/extensions/builder/session', { method: 'POST' });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || 'Failed to create builder session');
          }
          const data: { session: ChatSession } = await res.json();
          id = data.session.id;
          localStorage.setItem(STORAGE_KEY, id);
          setSessionModel(data.session.model || '');
          setSessionProviderId(data.session.provider_id || '');
          setSessionMode(data.session.mode || 'code');
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Failed to initialize builder');
            setLoading(false);
          }
          return;
        }
      }

      if (cancelled) return;
      setSessionId(id);
      await loadMessages(id);
      if (!cancelled) setLoading(false);
    }

    init();
    return () => { cancelled = true; };
  }, [loadMessages]);

  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      loadMessages(sessionId).catch(() => {});
    }, 4000);
    return () => {
      clearInterval(interval);
    };
  }, [loadMessages, sessionId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <HugeiconsIcon icon={Loading} className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!sessionId) {
    return null;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HugeiconsIcon icon={Sparkles} className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{t('extensions.builderTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('extensions.builderDesc')}</p>
            <div className="mt-2 text-xs text-muted-foreground space-y-1">
              <p>{t('extensions.builderHint1')}</p>
              <p>{t('extensions.builderHint2')}</p>
              <p>{t('extensions.builderHint3')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ChatView
          key={sessionId}
          sessionId={sessionId}
          initialMessages={messages}
          initialHasMore={hasMore}
          modelName={sessionModel}
          initialMode={sessionMode}
          providerId={sessionProviderId}
        />
      </div>
    </div>
  );
}
