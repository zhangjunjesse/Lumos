'use client';

import { useEffect, useState, useRef, useCallback, use } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MessagesResponse, ChatSession, SessionsResponse } from '@/types';
import { ChatView } from '@/components/chat/ChatView';
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete, Loading, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BindingButton } from '@/components/bridge/BindingButton';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getPostDeleteRedirectPath,
  getSessionEntry,
  getSessionEntryBasePath,
  getSessionEntryFromPath,
} from '@/lib/chat/session-entry';
import { useMessagesStore } from '@/stores/messages-store';
import { useStreamingStore } from '@/stores/streaming-store';

interface ChatSessionPageProps {
  params: Promise<{ id: string }>;
}

interface BridgeInboundEventPayload {
  sessionId?: string;
  messageId?: string;
  previewText?: string;
}

function triggerMemoryOnSessionSwitch(sessionId: string): void {
  if (!sessionId) return;
  fetch('/api/memory/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      sessionId,
      trigger: 'session_switch',
    }),
  }).catch(() => {
    // Best effort only.
  });
}

export default function ChatSessionPage({ params }: ChatSessionPageProps) {
  const { id } = use(params);
  const pathname = usePathname();
  const router = useRouter();
  const sessionData = useMessagesStore((state) => state.sessions[id] ?? null);
  const getMessagesSession = useMessagesStore((state) => state.getSession);
  const updateSessionMessages = useMessagesStore((state) => state.updateSession);
  const removeCachedMessages = useMessagesStore((state) => state.clearSession);
  const sessionStreamingState = useStreamingStore((state) => state.sessions[id] ?? null);
  const updateStreamingSession = useStreamingStore((state) => state.updateSession);
  const clearStreamingSession = useStreamingStore((state) => state.clearSession);

  const messages = sessionData?.messages || [];
  const hasMore = sessionData?.hasMore || false;
  const loading = sessionData?.loading ?? true;
  const error = sessionData?.error || null;

  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [sessionModel, setSessionModel] = useState<string>('');
  const [resolvedModel, setResolvedModel] = useState<string>('');
  const [sessionProviderId, setSessionProviderId] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [sessionWorkingDir, setSessionWorkingDir] = useState<string>('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bridgePendingMessageIdsRef = useRef<Set<string>>(new Set());
  const { setWorkingDirectory, setSessionId, setSessionTitle: setPanelSessionTitle, setPanelOpen } = usePanel();
  const { t } = useTranslation();
  const routeEntry = getSessionEntryFromPath(pathname);
  const routeBasePath = getSessionEntryBasePath(routeEntry);

  const handleStartEditTitle = useCallback(() => {
    setEditTitle(sessionTitle || t('chat.newConversation'));
    setIsEditingTitle(true);
  }, [sessionTitle, t]);

  const handleSaveTitle = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setIsEditingTitle(false);
      return;
    }
    try {
      const res = await fetch(`/api/chat/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setSessionTitle(trimmed);
        setPanelSessionTitle(trimmed);
        window.dispatchEvent(new CustomEvent('session-updated', { detail: { id, title: trimmed } }));
      }
    } catch {
      // silently fail
    }
    setIsEditingTitle(false);
  }, [editTitle, id, setPanelSessionTitle]);

  const handleDeleteSession = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      let fallbackSessionId = '';
      if (routeEntry !== 'main-agent') {
        try {
          const sessionsRes = await fetch(`/api/chat/sessions?entry=${routeEntry}`, {
            cache: 'no-store',
          });
          if (sessionsRes.ok) {
            const data: SessionsResponse = await sessionsRes.json();
            const sessions = Array.isArray(data.sessions) ? data.sessions : [];
            const currentIndex = sessions.findIndex((session) => session.id === id);

            if (currentIndex >= 0) {
              fallbackSessionId = sessions[currentIndex + 1]?.id
                || sessions[currentIndex - 1]?.id
                || sessions.find((session) => session.id !== id)?.id
                || '';
            } else {
              fallbackSessionId = sessions[0]?.id || '';
            }
          }
        } catch {
          // fallback navigation handled below
        }
      }

      const res = await fetch(`/api/chat/sessions/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        removeCachedMessages(id);
        clearStreamingSession(id);
        setSessionId('');
        setPanelSessionTitle('');
        window.dispatchEvent(new CustomEvent('session-deleted', { detail: { id } }));
        router.push(getPostDeleteRedirectPath(routeEntry, fallbackSessionId));
      }
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }, [
    clearStreamingSession,
    deleting,
    id,
    removeCachedMessages,
    routeEntry,
    router,
    setPanelSessionTitle,
    setSessionId,
  ]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
    }
  }, [handleSaveTitle]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const refreshLatestMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/sessions/${id}/messages?limit=100`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        if (res.status === 404) {
          updateSessionMessages(id, {
            loading: false,
            error: t('chat.sessionNotFound'),
          });
        }
        return;
      }

      const data: MessagesResponse = await res.json();
      const nextMessages = data.messages || [];
      const current = getMessagesSession(id);
      const currentMessages = current?.messages || [];

      const sameLength = currentMessages.length === nextMessages.length;
      const sameLastId = sameLength
        && currentMessages.length > 0
        && currentMessages[currentMessages.length - 1]?.id === nextMessages[nextMessages.length - 1]?.id;

      if (sameLength && sameLastId && !current?.loading && !current?.error) {
        return;
      }

      updateSessionMessages(id, {
        messages: nextMessages,
        hasMore: data.hasMore ?? false,
        loading: false,
        error: null,
      });
    } catch (err) {
      updateSessionMessages(id, {
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load messages',
      });
    }
  }, [id, t, getMessagesSession, updateSessionMessages]);

  const injectInboundPreviewMessage = useCallback((payload: BridgeInboundEventPayload) => {
    if (!payload.messageId || !payload.previewText) {
      return;
    }

    const tempId = `temp-feishu-${payload.messageId}`;
    const currentMessages = getMessagesSession(id)?.messages || [];
    if (currentMessages.some((message) => message.id === tempId)) {
      return;
    }

    updateSessionMessages(id, {
      messages: [
        ...currentMessages,
        {
          id: tempId,
          session_id: id,
          role: 'user',
          content: `<!--source:feishu-->${payload.previewText}`,
          created_at: new Date().toISOString(),
          token_usage: null,
        },
      ],
      hasMore: getMessagesSession(id)?.hasMore ?? false,
      loading: false,
      error: null,
    });
  }, [getMessagesSession, id, updateSessionMessages]);

  const updateBridgeStreamingState = useCallback(() => {
    const pendingCount = bridgePendingMessageIdsRef.current.size;
    if (pendingCount <= 0) {
      updateStreamingSession(id, {
        status: 'idle',
        content: '',
        toolUses: [],
        toolResults: [],
        streamingToolOutput: '',
        statusText: '',
        pendingPermission: null,
        permissionResolved: null,
      });
      return;
    }

    const queuedCount = Math.max(0, pendingCount - 1);
    updateStreamingSession(id, {
      status: 'streaming',
      content: '',
      toolUses: [],
      toolResults: [],
      streamingToolOutput: '',
      statusText: queuedCount > 0
        ? `飞书消息处理中，队列中还有 ${queuedCount} 条`
        : '飞书消息处理中...',
      pendingPermission: null,
      permissionResolved: null,
    });
  }, [id, updateStreamingSession]);

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch(`/api/chat/sessions/${id}`, { cache: 'no-store' });
        if (!res.ok) return;

        const data: { session: ChatSession } = await res.json();
        const actualEntry = getSessionEntry(data.session);
        if (actualEntry !== routeEntry) {
          router.replace(`${getSessionEntryBasePath(actualEntry)}/${id}`);
          return;
        }

        if (data.session.working_directory) {
          setWorkingDirectory(data.session.working_directory);
          setSessionWorkingDir(data.session.working_directory);
          localStorage.setItem("lumos:last-working-directory", data.session.working_directory);
          window.dispatchEvent(new Event('refresh-file-tree'));
        } else {
          setWorkingDirectory('');
          setSessionWorkingDir('');
          window.dispatchEvent(new Event('refresh-file-tree'));
        }

        setSessionId(id);
        setPanelOpen(true);
        const title = data.session.title || t('chat.newConversation');
        setSessionTitle(title);
        setPanelSessionTitle(title);
        setSessionModel(data.session.requested_model || data.session.model || '');
        setResolvedModel(data.session.resolved_model || '');
        setSessionProviderId(data.session.provider_id || '');
        setProjectName(data.session.project_name || '');
      } catch (err) {
        console.error('[ChatSessionPage] Failed to load session:', err);
      }
    }

    loadSession();
  }, [id, routeEntry, router, setPanelOpen, setPanelSessionTitle, setSessionId, setWorkingDirectory, t]);

  useEffect(() => {
    const shouldFetchMessages = !sessionData || (!!sessionData.error && !sessionData.loading);
    if (!shouldFetchMessages) return;

    updateSessionMessages(id, { loading: true, error: null });

    let cancelled = false;

    async function loadMessages() {
      await refreshLatestMessages();
      if (cancelled) return;
    }

    loadMessages();

    return () => {
      cancelled = true;
    };
  }, [id, refreshLatestMessages, sessionData, updateSessionMessages]);

  useEffect(() => {
    if (sessionStreamingState?.status !== 'completed') return;
    updateStreamingSession(id, {
      status: 'idle',
      content: '',
      toolUses: [],
      toolResults: [],
      streamingToolOutput: '',
      statusText: '',
      pendingPermission: null,
      permissionResolved: null,
    });
  }, [id, sessionStreamingState?.status, updateStreamingSession]);

  useEffect(() => {
    const current = id;
    return () => {
      triggerMemoryOnSessionSwitch(current);
    };
  }, [id]);

  // Refresh messages when tab becomes visible (SSE handles real-time updates)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshLatestMessages().catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshLatestMessages]);

  useEffect(() => {
    const handleBridgeEvent = (eventName: string, payload: unknown) => {
      const detail = payload as BridgeInboundEventPayload | null;
      if (!detail?.sessionId || detail.sessionId !== id) return;

      if (eventName === 'inbound-processing') {
        if (detail.messageId) {
          bridgePendingMessageIdsRef.current.add(detail.messageId);
        }
        injectInboundPreviewMessage(detail);
        updateBridgeStreamingState();

        void refreshLatestMessages();
        window.setTimeout(() => {
          void refreshLatestMessages();
        }, 300);
        window.setTimeout(() => {
          void refreshLatestMessages();
        }, 1200);
        return;
      }

      if (eventName === 'inbound-completed' || eventName === 'inbound-failed') {
        if (detail.messageId) {
          bridgePendingMessageIdsRef.current.delete(detail.messageId);
        } else {
          bridgePendingMessageIdsRef.current.clear();
        }
        void refreshLatestMessages().finally(() => {
          updateBridgeStreamingState();
        });
      }
    };

    const unsubscribe = window.electronAPI?.bridge?.onEvent?.(handleBridgeEvent);
    if (unsubscribe) {
      return unsubscribe;
    }
  }, [id, injectInboundPreviewMessage, refreshLatestMessages, updateBridgeStreamingState]);

  useEffect(() => {
    const handleTeamMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId !== id) return;

      fetch(`/api/chat/sessions/${id}/messages?limit=100`, { cache: 'no-store' })
        .then((res) => res.ok ? res.json() as Promise<MessagesResponse> : null)
        .then((data) => {
          if (!data) return;
          updateSessionMessages(id, {
            messages: data.messages,
            hasMore: data.hasMore ?? false,
            loading: false,
            error: null,
          });
        })
        .catch(() => {
          // Best effort only.
        });
    };

    window.addEventListener('team-chat-message-created', handleTeamMessage);
    return () => window.removeEventListener('team-chat-message-created', handleTeamMessage);
  }, [id, updateSessionMessages]);

  useEffect(() => {
    const handleSessionUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ id?: string; title?: string }>;
      const detail = customEvent.detail;
      if (!detail?.id) return;
      if (detail.id === id && detail.title) {
        setSessionTitle(detail.title);
        setEditTitle(detail.title);
        setPanelSessionTitle(detail.title);
      }
    };

    window.addEventListener('session-updated', handleSessionUpdate);
    return () => window.removeEventListener('session-updated', handleSessionUpdate);
  }, [id, setPanelSessionTitle]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <HugeiconsIcon icon={Loading} className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-2 text-center">
          <p className="font-medium text-destructive">{error}</p>
          <Link href={routeBasePath} className="text-sm text-muted-foreground hover:underline">
            {t('chat.startNewChat')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {sessionTitle && (
          <div
            className="flex h-12 shrink-0 items-center justify-center gap-1 px-4"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            {projectName && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="shrink-0 cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      onClick={() => {
                        if (!sessionWorkingDir) return;
                        if (window.electronAPI?.shell?.openPath) {
                          window.electronAPI.shell.openPath(sessionWorkingDir);
                          return;
                        }
                        fetch('/api/files/open', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: sessionWorkingDir }),
                        }).catch(() => {});
                      }}
                    >
                      {projectName}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="break-all text-xs">{sessionWorkingDir || projectName}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{t('chat.openInFinder')}</p>
                  </TooltipContent>
                </Tooltip>
                <span className="shrink-0 text-xs text-muted-foreground">/</span>
              </>
            )}
            {isEditingTitle ? (
              <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <Input
                  ref={titleInputRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={handleSaveTitle}
                  className="h-7 max-w-md text-center text-sm"
                />
              </div>
            ) : (
              <div
                className="group flex max-w-3xl cursor-default items-center gap-1"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium text-foreground/80">
                    {sessionTitle}
                  </h2>
                </div>
                <button
                  onClick={handleStartEditTitle}
                  className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                >
                  <HugeiconsIcon icon={PencilEdit01Icon} className="h-3 w-3 text-muted-foreground" />
                </button>
                <BindingButton sessionId={id} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setDeleteDialogOpen(true)}
                      className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                    >
                      <HugeiconsIcon icon={Delete} className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('chat.deleteConversation')}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        )}

        <ChatView
          sessionId={id}
          initialMessages={messages}
          initialHasMore={hasMore}
          modelName={sessionModel}
          resolvedModelName={resolvedModel}
          providerId={sessionProviderId}
          onRequestedModelChange={setSessionModel}
          onResolvedModelChange={setResolvedModel}
        />

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('chat.deleteSessionTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('chat.deleteSessionDesc')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteSession}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? t('common.loading') : t('chat.deleteSessionConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
