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

interface ElectronIpcRendererLike {
  on: (channel: string, listener: (event: unknown, payload: { sessionId: string }) => void) => void;
  removeListener: (channel: string, listener: (event: unknown, payload: { sessionId: string }) => void) => void;
}

type WindowWithElectronIpc = Window & {
  electron?: {
    ipcRenderer?: ElectronIpcRendererLike;
  };
};

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
  const [sessionMode, setSessionMode] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [sessionWorkingDir, setSessionWorkingDir] = useState<string>('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
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
          const sessionsRes = await fetch(`/api/chat/sessions?entry=${routeEntry}`);
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
    routeBasePath,
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

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch(`/api/chat/sessions/${id}`);
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
          localStorage.setItem("codepilot:last-working-directory", data.session.working_directory);
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
        setSessionMode(data.session.mode || 'code');
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
      try {
        const res = await fetch(`/api/chat/sessions/${id}/messages?limit=100`);
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            updateSessionMessages(id, {
              loading: false,
              error: t('chat.sessionNotFound'),
            });
            return;
          }
          throw new Error(t('chat.failedLoadMessages'));
        }

        const data: MessagesResponse = await res.json();
        if (cancelled) return;
        updateSessionMessages(id, {
          messages: data.messages,
          hasMore: data.hasMore ?? false,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        updateSessionMessages(id, {
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load messages',
        });
      }
    }

    loadMessages();

    return () => {
      cancelled = true;
    };
  }, [id, sessionData, t, updateSessionMessages]);

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

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const refreshMessages = () => {
      if (cancelled || inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      inFlight = true;
      fetch(`/api/chat/sessions/${id}/messages?limit=100`)
        .then((res) => {
          if (!res.ok) return null;
          return res.json() as Promise<MessagesResponse>;
        })
        .then((data) => {
          if (!data || cancelled) return;
          updateSessionMessages(id, {
            messages: data.messages,
            hasMore: data.hasMore ?? false,
            loading: false,
            error: null,
          });
        })
        .catch((err) => {
          console.error('[ChatPage] Polling messages failed:', err);
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const interval = setInterval(refreshMessages, 4000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshMessages();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id, updateSessionMessages]);

  useEffect(() => {
    const handleBridgeMessage = (_event: unknown, data: { sessionId: string }) => {
      if (data.sessionId !== id) return;

      fetch(`/api/chat/sessions/${id}/messages?limit=100`)
        .then((res) => {
          if (!res.ok) return null;
          return res.json() as Promise<MessagesResponse>;
        })
        .then((data: MessagesResponse | null) => {
          if (!data) return;
          updateSessionMessages(id, {
            messages: data.messages,
            hasMore: data.hasMore ?? false,
            loading: false,
            error: null,
          });
        })
        .catch((err) => console.error('[Bridge] Failed to refresh messages:', err));
    };

    const ipcRenderer = (window as WindowWithElectronIpc).electron?.ipcRenderer;
    if (typeof window !== 'undefined' && ipcRenderer) {
      ipcRenderer.on('bridge:message-received', handleBridgeMessage);
      return () => {
        ipcRenderer.removeListener('bridge:message-received', handleBridgeMessage);
      };
    }
  }, [id, updateSessionMessages]);

  useEffect(() => {
    const handleTeamMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId !== id) return;

      fetch(`/api/chat/sessions/${id}/messages?limit=100`)
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
    <div className="flex h-full min-h-0 flex-col">
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
        initialMode={sessionMode}
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
  );
}
