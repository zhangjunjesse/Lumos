'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading } from '@hugeicons/core-free-icons';

import { ChatView } from '@/components/chat/ChatView';
import type { ChatSession, Message, MessagesResponse } from '@/types';

type AppBuilderConfigResponse = {
  providerId?: string;
  model?: string;
  providerModels?: {
    default_provider_id?: string;
    groups?: Array<{
      provider_id: string;
      models: Array<{ value: string; label: string }>;
    }>;
  };
};

type AppBuilderChatPanelProps = {
  builderSessionId: string;
  compactInputOnly?: boolean;
  onInputFocus?: () => void;
  fullWidth?: boolean;
  hideEmptyState?: boolean;
  onTurnComplete?: () => void;
};

export function AppBuilderChatPanel({
  builderSessionId,
  compactInputOnly = false,
  onInputFocus,
  fullWidth = false,
  hideEmptyState = false,
  onTurnComplete,
}: AppBuilderChatPanelProps) {
  const [sessionId, setSessionId] = useState('');
  const [sessionModel, setSessionModel] = useState('');
  const [sessionProviderId, setSessionProviderId] = useState('');
  const [sessionWorkingDirectory, setSessionWorkingDirectory] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const chatEndpoint = useMemo(
    () => `/api/apps/builder/sessions/${encodeURIComponent(builderSessionId)}/chat/stream`,
    [builderSessionId],
  );

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
      if (!builderSessionId) return;
      setLoading(true);
      setError('');

      let nextSession: ChatSession | null = null;
      try {
        const lookupRes = await fetch(
          `/api/apps/builder/chat/session?builderSessionId=${encodeURIComponent(builderSessionId)}`,
        );
        if (!lookupRes.ok) {
          throw new Error(`Lookup failed (${lookupRes.status})`);
        }
        const lookupData = await lookupRes.json() as { session: ChatSession | null };
        nextSession = lookupData.session;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载应用开发会话失败，请重试');
          setLoading(false);
        }
        return;
      }

      if (!nextSession) {
        try {
          const res = await fetch('/api/apps/builder/chat/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ builderSessionId }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error || '初始化应用开发会话失败');
          }
          const data: { session: ChatSession } = await res.json();
          nextSession = data.session;
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : '初始化应用开发会话失败');
            setLoading(false);
          }
          return;
        }
      }

      if (!nextSession || cancelled) return;

      const normalizedSession = await normalizeAppBuilderSessionProvider(nextSession);
      if (cancelled) return;

      setSessionId(normalizedSession.id);
      setSessionModel(normalizedSession.model || '');
      setSessionProviderId(normalizedSession.provider_id || '');
      setSessionWorkingDirectory(nextSession.working_directory || '');
      await loadMessages(normalizedSession.id);
      if (!cancelled) setLoading(false);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [builderSessionId, loadMessages]);

  useEffect(() => {
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
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
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
          chatEndpoint={chatEndpoint}
          providerModelsEndpoint="/api/apps/builder/config"
          onStreamComplete={onTurnComplete}
        />
      </div>
    </div>
  );
}

async function normalizeAppBuilderSessionProvider(session: ChatSession): Promise<ChatSession> {
  const configRes = await fetch('/api/apps/builder/config');
  if (!configRes.ok) return session;

  const config = await configRes.json() as AppBuilderConfigResponse;
  const groups = config.providerModels?.groups ?? [];
  const defaultProviderId = config.providerModels?.default_provider_id || groups[0]?.provider_id || '';
  const currentGroup = groups.find((group) => group.provider_id === session.provider_id);
  const targetGroup = currentGroup || groups.find((group) => group.provider_id === defaultProviderId) || groups[0];
  const targetProviderId = targetGroup?.provider_id || session.provider_id || '';
  const currentModel = session.model || config.model || '';
  const targetModel = targetGroup?.models.some((model) => model.value === currentModel)
    ? currentModel
    : targetGroup?.models[0]?.value || currentModel;

  if (
    !session.id
    || !targetProviderId
    || (session.provider_id === targetProviderId && session.model === targetModel)
  ) {
    return {
      ...session,
      provider_id: targetProviderId || session.provider_id,
      model: targetModel || session.model,
    };
  }

  const patchRes = await fetch(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider_id: targetProviderId, model: targetModel }),
  });
  if (!patchRes.ok) {
    return {
      ...session,
      provider_id: targetProviderId,
      model: targetModel,
    };
  }
  const data = await patchRes.json() as { session?: ChatSession };
  return data.session ?? {
    ...session,
    provider_id: targetProviderId,
    model: targetModel,
  };
}
