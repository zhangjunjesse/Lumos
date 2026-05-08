'use client';

import * as React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading } from '@hugeicons/core-free-icons';

import { ChatView } from '@/components/chat/ChatView';
import { useMessagesStore } from '@/stores/messages-store';
import type { ChatSession, Message, MessagesResponse } from '@/types';

const STORAGE_KEY = 'lumos:wechat-assistant-chat-session';

interface WeChatChatPanelProps {
  compactInputOnly?: boolean;
  onInputFocus?: () => void;
  onUpdated?: () => Promise<void> | void;
  fullWidth?: boolean;
  hideEmptyState?: boolean;
}

export function WeChatChatPanel({
  compactInputOnly = false,
  onInputFocus,
  onUpdated,
  fullWidth = false,
  hideEmptyState = false,
}: WeChatChatPanelProps): React.ReactElement | null {
  const [sessionId, setSessionId] = React.useState('');
  const [sessionModel, setSessionModel] = React.useState('');
  const [sessionProviderId, setSessionProviderId] = React.useState('');
  const [sessionWorkingDirectory, setSessionWorkingDirectory] = React.useState('');
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const updateMessagesSession = useMessagesStore((state) => state.updateSession);

  const loadMessages = React.useCallback(async (id: string) => {
    const res = await fetch(`/api/chat/sessions/${id}/messages?limit=100`, {
      cache: 'no-store',
    });
    if (!res.ok) return;
    const data = (await res.json()) as MessagesResponse;
    const nextMessages = data.messages || [];
    const nextHasMore = data.hasMore ?? false;
    setMessages(nextMessages);
    setHasMore(nextHasMore);
    updateMessagesSession(id, {
      messages: nextMessages,
      hasMore: nextHasMore,
      loading: false,
      error: null,
    });
  }, [updateMessagesSession]);

  React.useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError('');

      const cachedId = typeof window !== 'undefined'
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;

      let nextSession: ChatSession | null = null;
      try {
        const res = await fetch('/api/apps/builtin/wechat/chat/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cachedId ? { session_id: cachedId } : {}),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || '初始化微信助手会话失败');
        }
        const data = (await res.json()) as { session: ChatSession };
        nextSession = data.session;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, data.session.id);
        }
      } catch (err) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(STORAGE_KEY);
        }
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '初始化微信助手会话失败');
          setLoading(false);
        }
        return;
      }

      if (!nextSession || cancelled) return;

      setSessionId(nextSession.id);
      setSessionModel(nextSession.model || '');
      setSessionProviderId(nextSession.provider_id || '');
      setSessionWorkingDirectory(nextSession.working_directory || '');
      await loadMessages(nextSession.id);
      if (!cancelled) setLoading(false);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [loadMessages]);

  React.useEffect(() => {
    if (!sessionId) return;
    const interval = window.setInterval(() => {
      void loadMessages(sessionId);
    }, 4000);
    return () => window.clearInterval(interval);
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

  if (!sessionId) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <ChatView
          key={sessionId}
          sessionId={sessionId}
          initialMessages={messages}
          initialHasMore={hasMore}
          modelName={sessionModel}
          providerId={sessionProviderId}
          workingDirectoryOverride={sessionWorkingDirectory}
          compactInputOnly={compactInputOnly}
          onInputFocus={onInputFocus}
          fullWidth={fullWidth}
          hideEmptyState={hideEmptyState}
          onStreamComplete={() => {
            void onUpdated?.();
          }}
        />
      </div>
    </div>
  );
}
