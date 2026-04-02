'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type {
  ChatKnowledgeOptions,
  Message,
  MessagesResponse,
  PermissionRequestEvent,
  FileAttachment,
  TeamBannerProjectionV1,
} from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { useTaskEvents } from '@/hooks/useTaskEvents';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { TaskStatusBar } from './TaskStatusBar';
import { usePanel } from '@/hooks/usePanel';
import { consumePendingChatBootstrap } from '@/lib/chat/session-bootstrap';
import { consumeSSEStream } from '@/hooks/useSSEStream';
import { BatchExecutionDashboard, BatchContextSync } from './batch-image-gen';
import { setLastGeneratedImages, transferPendingToMessage } from '@/lib/image-ref-store';
import { extractChromeMcpUrl, openBrowserUrlInPanel } from '@/lib/chrome-mcp';
import { getSessionEntryBasePath, getSessionEntryFromPath } from '@/lib/chat/session-entry';
import { useStreamingStore } from '@/stores/streaming-store';
import { useMessagesStore } from '@/stores/messages-store';
import {
  abortChatStream,
  clearChatStreamController,
  getChatStreamController,
  registerChatStreamController,
} from '@/lib/chat-stream-controller-registry';
import { BUILTIN_CLAUDE_MODEL_IDS } from '@/lib/model-metadata';
import { ProviderSwitchDialog } from './ProviderSwitchDialog';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface ChatViewProps {
  sessionId: string;
  initialMessages?: Message[];
  initialHasMore?: boolean;
  modelName?: string;
  resolvedModelName?: string;
  initialKnowledgeEnabled?: boolean;
  providerId?: string;
  workingDirectoryOverride?: string;
  compactInputOnly?: boolean;
  onInputFocus?: () => void;
  fullWidth?: boolean;
  hideEmptyState?: boolean;
  onRequestedModelChange?: (model: string) => void;
  onResolvedModelChange?: (model: string) => void;
}

interface MemoryIdleTriggerConfig {
  enabled: boolean;
  timeoutMs: number;
}

const DEFAULT_MEMORY_IDLE_TIMEOUT_MS = 120_000;
const MIN_MEMORY_IDLE_TIMEOUT_MS = 10_000;
const EMPTY_MESSAGES: Message[] = [];

async function getBrowserBridgeHeaders(): Promise<Record<string, string>> {
  if (typeof window === 'undefined' || !window.electronAPI?.browser?.getBridgeConfig) {
    return {};
  }

  try {
    const bridge = await window.electronAPI.browser.getBridgeConfig();
    if (!bridge?.success) return {};

    const headers: Record<string, string> = {};
    if (bridge.url) headers['x-lumos-browser-bridge-url'] = bridge.url;
    if (bridge.token) headers['x-lumos-browser-bridge-token'] = bridge.token;
    return headers;
  } catch {
    return {};
  }
}

function isTempMessageId(id: string): boolean {
  return id.startsWith('temp-');
}

function haveSameMessageSequence(a: Message[], b: Message[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index]?.id !== b[index]?.id) {
      return false;
    }
  }

  return true;
}

export function ChatView({
  sessionId,
  initialMessages = EMPTY_MESSAGES,
  initialHasMore = false,
  modelName,
  resolvedModelName,
  initialKnowledgeEnabled = false,
  providerId,
  workingDirectoryOverride,
  compactInputOnly = false,
  onInputFocus,
  fullWidth = false,
  hideEmptyState = false,
  onRequestedModelChange,
  onResolvedModelChange,
}: ChatViewProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { setStreamingSessionId, workingDirectory, setPendingApprovalSessionId, setContentPanelOpen } = usePanel();
  const effectiveWorkingDirectory = useMemo(
    () => workingDirectoryOverride || workingDirectory,
    [workingDirectoryOverride, workingDirectory]
  );

  const cachedMessagesSession = useMessagesStore((state) => state.sessions[sessionId] ?? null);
  const updateMessagesSession = useMessagesStore((state) => state.updateSession);

  const cachedStreamingState = useStreamingStore((state) => state.sessions[sessionId] ?? null);
  const startStreamingSession = useStreamingStore((state) => state.startStreaming);
  const updateStreamingSession = useStreamingStore((state) => state.updateSession);
  const completeStreamingSession = useStreamingStore((state) => state.completeStreaming);
  const errorStreamingSession = useStreamingStore((state) => state.errorStreaming);
  const clearStreamingSession = useStreamingStore((state) => state.clearSession);

  const sourceMessages = cachedMessagesSession?.messages ?? initialMessages;
  const sourceHasMore = cachedMessagesSession?.hasMore ?? initialHasMore;
  const initialStreamingToolResults: ToolResultInfo[] = (cachedStreamingState?.toolResults || []).map((result) => ({
    tool_use_id: result.tool_use_id,
    content: result.content ?? '',
    is_error: result.is_error,
  }));
  const initialReasoningSummaries = cachedStreamingState?.reasoningSummaries || [];

  const [messages, setMessages] = useState<Message[]>(() => sourceMessages);
  const [hasMore, setHasMore] = useState(sourceHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [streamingContent, setStreamingContent] = useState(() => cachedStreamingState?.content || '');
  const [isStreaming, setIsStreaming] = useState(() => cachedStreamingState?.status === 'streaming');
  const [reasoningSummaries, setReasoningSummaries] = useState<string[]>(() => initialReasoningSummaries);
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>(() => cachedStreamingState?.toolUses || []);
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>(() => initialStreamingToolResults);
  const [statusText, setStatusText] = useState<string | undefined>(() => cachedStreamingState?.statusText || undefined);
  const [currentModel, setCurrentModel] = useState(
    modelName || (typeof window !== 'undefined' ? (localStorage.getItem('lumos:last-model') || localStorage.getItem('codepilot:last-model')) : null) || BUILTIN_CLAUDE_MODEL_IDS.sonnet
  );
  const [currentProviderId, setCurrentProviderId] = useState(providerId || '');
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const [switchDialogPayload, setSwitchDialogPayload] = useState<{ providerId: string; model: string; providerName?: string } | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(
    () => cachedStreamingState?.pendingPermission || null
  );
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | null>(
    () => cachedStreamingState?.permissionResolved || null
  );
  const [streamingToolOutput, setStreamingToolOutput] = useState(() => cachedStreamingState?.streamingToolOutput || '');
  const [memoryIdleConfig, setMemoryIdleConfig] = useState<MemoryIdleTriggerConfig>({
    enabled: true,
    timeoutMs: DEFAULT_MEMORY_IDLE_TIMEOUT_MS,
  });
  const mode = 'code';

  const messagesRef = useRef<Message[]>(sourceMessages);
  const hasMoreRef = useRef(sourceHasMore);
  const toolTimeoutRef = useRef<{ toolName: string; elapsedSeconds: number } | null>(null);
  const idleMemoryTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const accumulatedRef = useRef(cachedStreamingState?.content || '');
  const reasoningSummariesRef = useRef<string[]>(initialReasoningSummaries);
  const toolUsesRef = useRef<ToolUseInfo[]>(cachedStreamingState?.toolUses || []);
  const toolResultsRef = useRef<ToolResultInfo[]>(initialStreamingToolResults);
  const sendMessageRef = useRef<
    ((
      content: string,
      files?: FileAttachment[],
      systemPromptAppend?: string,
      displayOverride?: string,
      knowledgeOptions?: ChatKnowledgeOptions,
    ) => Promise<void>) | null
  >(null);
  const pendingImageNoticesRef = useRef<string[]>([]);
  const [taskBanner, setTaskBanner] = useState<TeamBannerProjectionV1 | null>(null);

  const syncMessagesFromServer = useCallback(async () => {
    if (messagesRef.current.some((message) => isTempMessageId(message.id))) {
      return;
    }

    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=100`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        return;
      }

      const data = await response.json() as MessagesResponse;
      const nextMessages = data.messages || [];
      const currentMessages = messagesRef.current;
      const sameLength = currentMessages.length === nextMessages.length;
      const sameLastId = sameLength
        && currentMessages[currentMessages.length - 1]?.id === nextMessages[nextMessages.length - 1]?.id;
      if (sameLength && sameLastId) {
        return;
      }

      messagesRef.current = nextMessages;
      hasMoreRef.current = data.hasMore ?? false;
      setMessages(nextMessages);
      setHasMore(data.hasMore ?? false);
      updateMessagesSession(sessionId, {
        messages: nextMessages,
        hasMore: data.hasMore ?? false,
        loading: false,
        error: null,
      });
    } catch {
      // Best effort only.
    }
  }, [sessionId, updateMessagesSession]);

  const refreshSessionMetadata = useCallback(async () => {
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        return;
      }

      const data = await response.json() as { session?: { title?: string } };
      const title = data.session?.title?.trim();
      if (title) {
        window.dispatchEvent(new CustomEvent('session-updated', {
          detail: { id: sessionId, title },
        }));
      }
    } catch {
      // Best effort only.
    }
  }, [sessionId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // SSE-based task events — replaces 2-second team-banner polling
  useTaskEvents({
    sessionId,
    enabled: !isStreaming,
    onEvent: useCallback(() => {
      void syncMessagesFromServer();
    }, [syncMessagesFromServer]),
    onSnapshot: useCallback((banner: unknown) => {
      setTaskBanner(banner as TeamBannerProjectionV1 | null);
    }, []),
  });

  const appendMessage = useCallback((message: Message) => {
    const next = [...messagesRef.current, message];
    messagesRef.current = next;
    setMessages(next);
    updateMessagesSession(sessionId, {
      messages: next,
      hasMore: hasMoreRef.current,
      loading: false,
      error: null,
    });
  }, [sessionId, updateMessagesSession]);

  const clearIdleMemoryTimer = useCallback(() => {
    if (idleMemoryTimerRef.current) {
      window.clearTimeout(idleMemoryTimerRef.current);
      idleMemoryTimerRef.current = null;
    }
  }, []);

  const scheduleIdleMemoryTrigger = useCallback(() => {
    clearIdleMemoryTimer();
    if (!memoryIdleConfig.enabled) return;

    const delay = Math.max(MIN_MEMORY_IDLE_TIMEOUT_MS, memoryIdleConfig.timeoutMs || DEFAULT_MEMORY_IDLE_TIMEOUT_MS);
    idleMemoryTimerRef.current = window.setTimeout(() => {
      fetch('/api/memory/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          trigger: 'idle',
        }),
      }).catch(() => {
        // Best effort only.
      });
    }, delay);
  }, [clearIdleMemoryTimer, memoryIdleConfig.enabled, memoryIdleConfig.timeoutMs, sessionId]);

  const resetStreamingUi = useCallback((controller?: AbortController | null) => {
    toolTimeoutRef.current = null;
    setIsStreaming(false);
    setStreamingSessionId('');
    setStreamingContent('');
    accumulatedRef.current = '';
    reasoningSummariesRef.current = [];
    setReasoningSummaries([]);
    toolUsesRef.current = [];
    toolResultsRef.current = [];
    setToolUses([]);
    setToolResults([]);
    setStreamingToolOutput('');
    setStatusText(undefined);
    setPendingPermission(null);
    setPermissionResolved(null);
    setPendingApprovalSessionId('');
    clearChatStreamController(sessionId, controller);
    if (!controller || abortControllerRef.current === controller) {
      abortControllerRef.current = null;
    }
  }, [sessionId, setPendingApprovalSessionId, setStreamingSessionId]);

  const executeSwitchProvider = useCallback(async (nextProviderId: string, model: string) => {
    setSwitchError(null);
    try {
      const entry = getSessionEntryFromPath(pathname);
      const createBody: Record<string, string> = {
        entry,
        mode,
        model,
        provider_id: nextProviderId,
      };

      const nextWorkingDirectory = effectiveWorkingDirectory.trim();
      if (entry !== 'main-agent' && nextWorkingDirectory) {
        createBody.working_directory = nextWorkingDirectory;
      }

      const response = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; session?: { id?: string } };
      if (!response.ok || !data.session?.id) {
        throw new Error(data.error || '创建新会话失败');
      }

      window.dispatchEvent(new CustomEvent('session-created'));
      router.push(`${getSessionEntryBasePath(entry)}/${data.session.id}`);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : '切换失败');
    }
  }, [effectiveWorkingDirectory, mode, pathname, router]);

  const handleProviderModelChange = useCallback(async (newProviderId: string, model: string) => {
    const nextProviderId = newProviderId.trim();
    const currentProvider = currentProviderId.trim();
    const providerChanged = Boolean(nextProviderId && currentProvider && nextProviderId !== currentProvider);
    const canForkSession = pathname === `/chat/${sessionId}` || pathname === `/main-agent/${sessionId}`;

    if (providerChanged && canForkSession) {
      if (isStreaming) {
        setSwitchError('AI 回复中，暂时不能切换');
        return;
      }

      setSwitchDialogPayload({ providerId: nextProviderId, model });
      setSwitchDialogOpen(true);
      return;
    }

    setCurrentProviderId(nextProviderId);
    setCurrentModel(model);
    onRequestedModelChange?.(model);
  }, [currentProviderId, isStreaming, onRequestedModelChange, pathname, sessionId]);

  // Cleanup on unmount - but don't abort streaming to allow background completion
  useEffect(() => {
    return () => {
      clearIdleMemoryTimer();
    };
  }, [clearIdleMemoryTimer]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/settings/app', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.settings) return;
        const settings = data.settings as Record<string, string>;
        const enabled = settings.memory_intelligence_trigger_idle_enabled !== 'false';
        const parsedTimeout = Number(settings.memory_intelligence_idle_timeout_ms || '');
        const timeoutMs = Number.isFinite(parsedTimeout)
          ? Math.max(MIN_MEMORY_IDLE_TIMEOUT_MS, Math.floor(parsedTimeout))
          : DEFAULT_MEMORY_IDLE_TIMEOUT_MS;
        setMemoryIdleConfig({ enabled, timeoutMs });
      })
      .catch(() => {
        // Use defaults when settings are unavailable.
      });

    return () => controller.abort();
  }, []);

  // Warn before closing window/tab while streaming to prevent accidental data loss
  useEffect(() => {
    if (!isStreaming) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isStreaming]);

  // Re-sync streaming content when the window regains visibility (Electron/browser tab switch)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && accumulatedRef.current) {
        setStreamingContent(accumulatedRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, []);

  // Seed message cache from page-provided initial payload when cache is empty.
  useEffect(() => {
    if (cachedMessagesSession) return;
    if (initialMessages.length === 0 && !initialHasMore) return;
    updateMessagesSession(sessionId, {
      messages: initialMessages,
      hasMore: initialHasMore,
      loading: false,
      error: null,
    });
  }, [cachedMessagesSession, initialHasMore, initialMessages, sessionId, updateMessagesSession]);

  // Keep local messages in sync with global cache / initial payload when not actively streaming.
  useEffect(() => {
    setMessages((prev) => {
      const localHasTemp = prev.some((msg) => isTempMessageId(msg.id));
      const sourceHasTemp = sourceMessages.some((msg) => isTempMessageId(msg.id));
      const prevLastId = prev[prev.length - 1]?.id;
      const sourceLastId = sourceMessages[sourceMessages.length - 1]?.id;
      const sameSequence = haveSameMessageSequence(prev, sourceMessages);

      if (isStreaming) {
        const shouldAcceptExternalUpdate = sourceHasTemp
          || (!localHasTemp && (prev.length !== sourceMessages.length || prevLastId !== sourceLastId));
        if (!shouldAcceptExternalUpdate) {
          return prev;
        }

        messagesRef.current = sourceMessages;
        return sourceMessages;
      }

      if (localHasTemp && sourceMessages.length < prev.length) {
        return prev;
      }
      if (sameSequence) {
        return prev;
      }
      messagesRef.current = sourceMessages;
      return sourceMessages;
    });
  }, [isStreaming, sourceMessages]);

  useEffect(() => {
    hasMoreRef.current = sourceHasMore;
    setHasMore(sourceHasMore);
  }, [sourceHasMore]);

  // Restore in-flight streaming UI from store when switching sessions.
  useEffect(() => {
    if (!cachedStreamingState) return;

    const streaming = cachedStreamingState.status === 'streaming';
    const hasLiveController = Boolean(
      getChatStreamController(sessionId)
      || abortControllerRef.current
    );
    const isStaleStreamingState = streaming && !hasLiveController;

    if (isStaleStreamingState) {
      clearStreamingSession(sessionId);
      setIsStreaming(false);
      setStreamingContent('');
      accumulatedRef.current = '';
      setReasoningSummaries([]);
      reasoningSummariesRef.current = [];
      setToolUses([]);
      toolUsesRef.current = [];
      setToolResults([]);
      toolResultsRef.current = [];
      setStreamingToolOutput('');
      setStatusText(undefined);
      setPendingPermission(null);
      setPermissionResolved(null);
      setStreamingSessionId('');
      setPendingApprovalSessionId('');
      return;
    }

    const cachedContent = cachedStreamingState.content || '';
    const cachedToolUses = cachedStreamingState.toolUses || [];
    const cachedToolResults: ToolResultInfo[] = (cachedStreamingState.toolResults || []).map((result) => ({
      tool_use_id: result.tool_use_id,
      content: result.content ?? '',
      is_error: result.is_error,
    }));

    setIsStreaming(streaming);
    setStreamingContent(cachedContent);
    accumulatedRef.current = cachedContent;
    setReasoningSummaries(cachedStreamingState.reasoningSummaries || []);
    reasoningSummariesRef.current = cachedStreamingState.reasoningSummaries || [];
    setToolUses(cachedToolUses);
    toolUsesRef.current = cachedToolUses;
    setToolResults(cachedToolResults);
    toolResultsRef.current = cachedToolResults;
    setStreamingToolOutput(cachedStreamingState.streamingToolOutput || '');
    setStatusText(cachedStreamingState.statusText || undefined);
    setPendingPermission(cachedStreamingState.pendingPermission || null);
    setPermissionResolved(cachedStreamingState.permissionResolved || null);

    if (streaming) {
      setStreamingSessionId(sessionId);
      if (cachedStreamingState.pendingPermission) {
        setPendingApprovalSessionId(sessionId);
      }
    }
  }, [
    cachedStreamingState,
    clearStreamingSession,
    sessionId,
    setPendingApprovalSessionId,
    setStreamingSessionId,
  ]);

  useEffect(() => {
    if (modelName) {
      setCurrentModel(modelName);
    }
  }, [modelName]);

  useEffect(() => {
    setCurrentProviderId(providerId || '');
  }, [providerId]);

  useEffect(() => {
    if (resolvedModelName) {
      onResolvedModelChange?.(resolvedModelName);
    }
  }, [onResolvedModelChange, resolvedModelName]);

  const loadEarlierMessages = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || messages.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const earliest = messages[0];
      const earliestRowId = (earliest as Message & { _rowid?: number })._rowid;
      if (!earliestRowId) return;
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=100&before=${earliestRowId}`);
      if (!res.ok) return;
      const data: MessagesResponse = await res.json();
      const nextHasMore = data.hasMore ?? false;
      hasMoreRef.current = nextHasMore;
      setHasMore(nextHasMore);
      if (data.messages.length > 0) {
        const next = [...data.messages, ...messagesRef.current];
        messagesRef.current = next;
        setMessages(next);
        updateMessagesSession(sessionId, {
          messages: next,
          hasMore: nextHasMore,
          loading: false,
          error: null,
        });
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, messages, sessionId, updateMessagesSession]);

  const stopStreaming = useCallback(() => {
    const aborted = abortChatStream(sessionId);
    if (!aborted) {
      const localController = abortControllerRef.current;
      if (localController) {
        localController.abort();
        return;
      }

      // Fallback for stale persisted UI state with no active controller.
      clearStreamingSession(sessionId);
      resetStreamingUi(null);
    }
  }, [clearStreamingSession, resetStreamingUi, sessionId]);

  const handlePermissionResponse = useCallback(async (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>) => {
    if (!pendingPermission) return;

    const body: {
      permissionRequestId: string;
      decision:
        | { behavior: 'allow'; updatedPermissions?: unknown[]; updatedInput?: Record<string, unknown> }
        | { behavior: 'deny'; message?: string }
    } = {
      permissionRequestId: pendingPermission.permissionRequestId,
      decision: decision === 'deny'
        ? { behavior: 'deny', message: 'User denied permission' }
        : {
            behavior: 'allow',
            ...(decision === 'allow_session' && pendingPermission.suggestions
              ? { updatedPermissions: pendingPermission.suggestions }
              : {}),
            ...(updatedInput ? { updatedInput } : {}),
          },
    };

    const resolved: 'allow' | 'deny' = decision === 'deny' ? 'deny' : 'allow';
    setPermissionResolved(resolved);
    setPendingApprovalSessionId('');
    updateStreamingSession(sessionId, {
      pendingPermission,
      permissionResolved: resolved,
      status: 'streaming',
    });

    try {
      await fetch('/api/chat/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Best effort - the stream will handle timeout
    }

    const answeredId = pendingPermission.permissionRequestId;
    setTimeout(() => {
      setPendingPermission((current) => {
        if (current?.permissionRequestId === answeredId) {
          setPermissionResolved(null);
          updateStreamingSession(sessionId, {
            pendingPermission: null,
            permissionResolved: null,
            status: 'streaming',
          });
          return null;
        }
        return current;
      });
    }, 1000);
  }, [pendingPermission, sessionId, setPendingApprovalSessionId, updateStreamingSession]);

  const sendMessage = useCallback(
    async (
      content: string,
      files?: FileAttachment[],
      systemPromptAppend?: string,
      displayOverride?: string,
      knowledgeOptions?: ChatKnowledgeOptions,
    ) => {
      if (isStreaming) return;
      clearIdleMemoryTimer();

      const displayUserContent = displayOverride || content;

      let displayContent = displayUserContent;
      if (files && files.length > 0) {
        const fileMeta = files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data }));
        displayContent = `<!--files:${JSON.stringify(fileMeta)}-->${displayUserContent}`;
      }

      const userMessage: Message = {
        id: 'temp-' + Date.now(),
        session_id: sessionId,
        role: 'user',
        content: displayContent,
        created_at: new Date().toISOString(),
        token_usage: null,
      };
      appendMessage(userMessage);
      setIsStreaming(true);
      setStreamingSessionId(sessionId);
      setStreamingContent('');
      accumulatedRef.current = '';
      reasoningSummariesRef.current = [];
      setReasoningSummaries([]);
      toolUsesRef.current = [];
      toolResultsRef.current = [];
      setToolUses([]);
      setToolResults([]);
      setStatusText(undefined);
      setStreamingToolOutput('');
      setPendingPermission(null);
      setPermissionResolved(null);
      setPendingApprovalSessionId('');

      startStreamingSession(sessionId);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      registerChatStreamController(sessionId, controller);

      let accumulated = '';
      let shouldScheduleIdleTrigger = false;
      let shouldMarkStreamError = false;
      let autoRetryPrompt: string | null = null;
      const streamStartMs = Date.now();

      const STREAM_IDLE_TIMEOUT_MS = 330_000;
      let lastEventTime = Date.now();
      let isIdleTimeout = false;
      const idleCheckTimer = setInterval(() => {
        if (Date.now() - lastEventTime >= STREAM_IDLE_TIMEOUT_MS) {
          clearInterval(idleCheckTimer);
          isIdleTimeout = true;
          controller.abort();
        }
      }, 10_000);
      const markActive = () => { lastEventTime = Date.now(); };

      let effectiveContent = content;
      if (pendingImageNoticesRef.current.length > 0) {
        const notices = pendingImageNoticesRef.current.join('\n\n');
        pendingImageNoticesRef.current = [];
        effectiveContent = `${notices}\n\n---\n\n${content}`;
      }

      try {
        const bridgeHeaders = await getBrowserBridgeHeaders();
        const apiEndpoint = sessionId === 'capability-authoring' ? '/api/capabilities/chat' : '/api/chat';

        // 为 capability-authoring 构建消息历史
        const requestBody: Record<string, unknown> = {
          session_id: sessionId,
          content: effectiveContent,
          mode,
          model: currentModel,
          provider_id: currentProviderId,
          knowledge_enabled: knowledgeOptions?.enabled === true,
          knowledge_tag_ids: knowledgeOptions?.tagIds ?? [],
          ...(files && files.length > 0 ? { files } : {}),
          ...(systemPromptAppend ? { systemPromptAppend } : {}),
        };

        if (sessionId === 'capability-authoring') {
          requestBody.messages = messagesRef.current
            .filter((message) => message.id !== userMessage.id)
            .map((message) => ({
              role: message.role,
              content: message.content,
            }));
        }

        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...bridgeHeaders,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to send message');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const result = await consumeSSEStream(reader, {
          onText: (acc) => {
            markActive();
            const isFirstVisibleContent = accumulated.length === 0;
            accumulated = acc;
            accumulatedRef.current = acc;
            setStreamingContent(acc);
            if (isFirstVisibleContent) {
              setStatusText(undefined);
            }
            const nextStreamingState: {
              content: string;
              status: 'streaming';
              statusText?: string;
            } = {
              content: acc,
              status: 'streaming',
            };
            if (isFirstVisibleContent) {
              nextStreamingState.statusText = '';
            }
            updateStreamingSession(sessionId, nextStreamingState);
          },
          onToolUseSummary: (summary) => {
            markActive();
            setReasoningSummaries((prev) => {
              if (prev[prev.length - 1] === summary) {
                return prev;
              }
              const next = [...prev, summary];
              reasoningSummariesRef.current = next;
              updateStreamingSession(sessionId, {
                reasoningSummaries: next,
                status: 'streaming',
              });
              return next;
            });
          },
          onToolUse: (tool) => {
            markActive();
            setStatusText(undefined);
            setStreamingToolOutput('');
            setToolUses((prev) => {
              if (prev.some((t) => t.id === tool.id)) return prev;
              const next = [...prev, tool];
              toolUsesRef.current = next;
              updateStreamingSession(sessionId, {
                toolUses: next,
                streamingToolOutput: '',
                statusText: '',
                status: 'streaming',
              });
              return next;
            });

            const browserUrl = extractChromeMcpUrl(tool.name, tool.input);
            if (browserUrl) {
              setContentPanelOpen(true);
              openBrowserUrlInPanel(browserUrl);
            }
          },
          onToolResult: (res) => {
            markActive();
            setStatusText(undefined);
            setStreamingToolOutput('');
            setToolResults((prev) => {
              const next = [...prev, res];
              toolResultsRef.current = next;
              updateStreamingSession(sessionId, {
                toolResults: next,
                streamingToolOutput: '',
                statusText: '',
                status: 'streaming',
              });
              return next;
            });
            window.dispatchEvent(new Event('refresh-file-tree'));
          },
          onToolOutput: (data) => {
            markActive();
            setStreamingToolOutput((prev) => {
              const next = prev + (prev ? '\n' : '') + data;
              const truncated = next.length > 5000 ? next.slice(-5000) : next;
              updateStreamingSession(sessionId, {
                streamingToolOutput: truncated,
                status: 'streaming',
              });
              return truncated;
            });
          },
          onToolProgress: (toolName, elapsed) => {
            markActive();
            const text = `Running ${toolName}... (${elapsed}s)`;
            setStatusText(text);
            updateStreamingSession(sessionId, {
              statusText: text,
              status: 'streaming',
            });
          },
          onStatus: (text, statusData) => {
            markActive();
            if (statusData?.model && typeof statusData.model === 'string') {
              onResolvedModelChange?.(statusData.model);
            }
            if (statusData?.session_id) {
              return;
            }
            setStatusText(text);
            updateStreamingSession(sessionId, {
              statusText: text || '',
              status: 'streaming',
            });
          },
          onResult: () => {
            markActive();
            /* token usage captured by consumeSSEStream */
          },
          onPermissionRequest: (permData) => {
            markActive();
            setPendingPermission(permData);
            setPermissionResolved(null);
            setPendingApprovalSessionId(sessionId);
            updateStreamingSession(sessionId, {
              pendingPermission: permData,
              permissionResolved: null,
              status: 'streaming',
            });
          },
          onToolTimeout: (toolName, elapsedSeconds) => {
            markActive();
            toolTimeoutRef.current = { toolName, elapsedSeconds };
          },
          onModeChanged: (sdkMode) => {
            markActive();
            if (sdkMode === 'plan') {
              console.log('[chat] Ignoring SDK mode change because input mode toggle is hidden');
            }
          },
          onError: (acc) => {
            markActive();
            shouldMarkStreamError = true;
            accumulated = acc;
            accumulatedRef.current = acc;
            setStreamingContent(acc);
            updateStreamingSession(sessionId, {
              content: acc,
              status: 'error',
            });
          },
        });

        accumulated = result.accumulated;

        const finalReasoningSummaries = reasoningSummariesRef.current;
        const finalToolUses = toolUsesRef.current;
        const finalToolResults = toolResultsRef.current;
        const hasStructuredBlocks = finalReasoningSummaries.length > 0 || finalToolUses.length > 0 || finalToolResults.length > 0;

        let messageContent = accumulated.trim();
        if (hasStructuredBlocks) {
          const contentBlocks: Array<Record<string, unknown>> = [];
          for (const summary of finalReasoningSummaries) {
            contentBlocks.push({ type: 'reasoning', summary });
          }
          for (const tu of finalToolUses) {
            contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
            const tr = finalToolResults.find((r) => r.tool_use_id === tu.id);
            if (tr) {
              contentBlocks.push({ type: 'tool_result', tool_use_id: tr.tool_use_id, content: tr.content });
            }
          }
          if (accumulated.trim()) {
            contentBlocks.push({ type: 'text', text: accumulated.trim() });
          }
          messageContent = JSON.stringify(contentBlocks);
        }

        if (messageContent) {
          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: sessionId,
            role: 'assistant',
            content: messageContent,
            created_at: new Date().toISOString(),
            token_usage: result.tokenUsage ? JSON.stringify(result.tokenUsage) : null,
            elapsed_ms: Date.now() - streamStartMs,
          };
          transferPendingToMessage(assistantMessage.id);
          appendMessage(assistantMessage);
          shouldScheduleIdleTrigger = true;
        }
      } catch (error) {
        clearInterval(idleCheckTimer);

        if (error instanceof DOMException && error.name === 'AbortError') {
          if (isIdleTimeout) {
            shouldMarkStreamError = true;
            const idleSecs = Math.round(STREAM_IDLE_TIMEOUT_MS / 1000);
            const idleMsg = t('chat.streamIdleTimeout').replace('{n}', String(idleSecs));
            const errContent = accumulated.trim()
              ? accumulated.trim() + `\n\n**Error:** ${idleMsg}`
              : `**Error:** ${idleMsg}`;
            const errMessage: Message = {
              id: 'temp-error-' + Date.now(),
              session_id: sessionId,
              role: 'assistant',
              content: errContent,
              created_at: new Date().toISOString(),
              token_usage: null,
            };
            appendMessage(errMessage);
          } else {
            const timeoutInfo = toolTimeoutRef.current;
            if (timeoutInfo) {
              if (accumulated.trim()) {
                const partialMessage: Message = {
                  id: 'temp-assistant-' + Date.now(),
                  session_id: sessionId,
                  role: 'assistant',
                  content: accumulated.trim() + `\n\n*(${t('chat.toolTimeout').replace('{name}', timeoutInfo.toolName).replace('{n}', String(timeoutInfo.elapsedSeconds))})*`,
                  created_at: new Date().toISOString(),
                  token_usage: null,
                };
                appendMessage(partialMessage);
              }
              autoRetryPrompt = `The previous tool "${timeoutInfo.toolName}" timed out after ${timeoutInfo.elapsedSeconds} seconds. Please try a different approach to accomplish the task. Avoid repeating the same operation that got stuck.`;
            } else if (accumulated.trim()) {
              const partialMessage: Message = {
                id: 'temp-assistant-' + Date.now(),
                session_id: sessionId,
                role: 'assistant',
                content: accumulated.trim() + `\n\n*(${t('chat.generationStopped')})*`,
                created_at: new Date().toISOString(),
                token_usage: null,
              };
              appendMessage(partialMessage);
            }
          }
        } else {
          shouldMarkStreamError = true;
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          const errorMessage: Message = {
            id: 'temp-error-' + Date.now(),
            session_id: sessionId,
            role: 'assistant',
            content: `**Error:** ${errMsg}`,
            created_at: new Date().toISOString(),
            token_usage: null,
          };
          appendMessage(errorMessage);
        }
      } finally {
        clearInterval(idleCheckTimer);
        resetStreamingUi(controller);

        if (shouldMarkStreamError) {
          errorStreamingSession(sessionId);
        } else {
          const isSessionActiveNow =
            pathname === `/chat/${sessionId}` || pathname === `/main-agent/${sessionId}`;
          if (isSessionActiveNow) {
            // Active session completion is immediately "read", so reset to idle.
            updateStreamingSession(sessionId, {
              status: 'idle',
              content: '',
              toolUses: [],
              toolResults: [],
              streamingToolOutput: '',
              statusText: '',
              pendingPermission: null,
              permissionResolved: null,
            });
          } else {
            // Inactive session completion means "completed but unread".
            completeStreamingSession(sessionId);
          }
        }

        window.dispatchEvent(new CustomEvent('refresh-file-tree'));
        window.dispatchEvent(new CustomEvent('team-plan-refresh', { detail: { sessionId } }));
        void refreshSessionMetadata();
        if (shouldScheduleIdleTrigger) {
          scheduleIdleMemoryTrigger();
        }
        if (autoRetryPrompt) {
          const retryPrompt = autoRetryPrompt;
          setTimeout(() => {
            sendMessageRef.current?.(retryPrompt);
          }, 500);
        }
      }
    },
    [
      appendMessage,
      clearIdleMemoryTimer,
      completeStreamingSession,
      currentModel,
      currentProviderId,
      errorStreamingSession,
      isStreaming,
      mode,
      onResolvedModelChange,
      pathname,
      resetStreamingUi,
      scheduleIdleMemoryTrigger,
      refreshSessionMetadata,
      sessionId,
      setContentPanelOpen,
      setPendingApprovalSessionId,
      setStreamingSessionId,
      startStreamingSession,
      t,
      updateStreamingSession,
    ]
  );

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    const pendingBootstrap = consumePendingChatBootstrap(sessionId);
    if (!pendingBootstrap) {
      return;
    }

    void sendMessage(
      pendingBootstrap.content,
      pendingBootstrap.files,
      pendingBootstrap.systemPromptAppend,
      pendingBootstrap.displayOverride,
      pendingBootstrap.knowledgeOptions,
    );
  }, [sendMessage, sessionId]);

  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case '/help': {
        const helpMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: sessionId,
          role: 'assistant',
          content: `## ${t('chat.helpTitle')}\n\n### ${t('chat.helpInstantCommands')}\n- **/help** — ${t('messageInput.helpDesc')}\n- **/clear** — ${t('messageInput.clearDesc')}\n- **/cost** — ${t('messageInput.costDesc')}\n\n### ${t('chat.helpPromptCommands')}\n- **/compact** — ${t('messageInput.compactDesc')}\n- **/doctor** — ${t('messageInput.doctorDesc')}\n- **/init** — ${t('messageInput.initDesc')}\n- **/review** — ${t('messageInput.reviewDesc')}\n- **/terminal-setup** — ${t('messageInput.terminalSetupDesc')}\n- **/memory** — ${t('messageInput.memoryDesc')}\n\n### ${t('chat.helpCustomSkills')}\n${t('chat.helpCustomSkillsDesc')}\n\n**${t('chat.helpTips')}:**\n- ${t('chat.helpTipSlash')}\n- ${t('chat.helpTipMention')}\n- ${t('chat.helpTipNewline')}\n- ${t('chat.helpTipFolder')}`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        appendMessage(helpMessage);
        break;
      }
      case '/clear':
        messagesRef.current = [];
        hasMoreRef.current = false;
        setMessages([]);
        setHasMore(false);
        updateMessagesSession(sessionId, {
          messages: [],
          hasMore: false,
          loading: false,
          error: null,
        });
        clearStreamingSession(sessionId);
        if (sessionId) {
          fetch(`/api/chat/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clear_messages: true }),
          }).catch(() => { /* silent */ });
        }
        break;
      case '/cost': {
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCacheCreation = 0;
        let totalCost = 0;
        let turnCount = 0;

        for (const msg of messages) {
          if (msg.token_usage) {
            try {
              const usage = typeof msg.token_usage === 'string' ? JSON.parse(msg.token_usage) : msg.token_usage;
              totalInput += usage.input_tokens || 0;
              totalOutput += usage.output_tokens || 0;
              totalCacheRead += usage.cache_read_input_tokens || 0;
              totalCacheCreation += usage.cache_creation_input_tokens || 0;
              if (usage.cost_usd) totalCost += usage.cost_usd;
              turnCount++;
            } catch { /* skip */ }
          }
        }

        const totalTokens = totalInput + totalOutput;
        let content: string;

        if (turnCount === 0) {
          content = `## ${t('chat.tokenUsageTitle')}\n\n${t('chat.noTokenUsageData')}`;
        } else {
          content = `## ${t('chat.tokenUsageTitle')}\n\n| ${t('chat.tokenMetric')} | ${t('chat.tokenCount')} |\n|--------|-------|\n| ${t('chat.tokenInput')} | ${totalInput.toLocaleString()} |\n| ${t('chat.tokenOutput')} | ${totalOutput.toLocaleString()} |\n| ${t('chat.tokenCacheRead')} | ${totalCacheRead.toLocaleString()} |\n| ${t('chat.tokenCacheCreation')} | ${totalCacheCreation.toLocaleString()} |\n| **${t('chat.tokenTotal')}** | **${totalTokens.toLocaleString()}** |\n| ${t('chat.tokenTurns')} | ${turnCount} |${totalCost > 0 ? `\n| **${t('chat.tokenEstimatedCost')}** | **$${totalCost.toFixed(4)}** |` : ''}`;
        }

        const costMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: sessionId,
          role: 'assistant',
          content,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        appendMessage(costMessage);
        break;
      }
      default:
        sendMessage(command);
    }
  }, [appendMessage, clearStreamingSession, messages, sendMessage, sessionId, t, updateMessagesSession]);

  // Listen for image generation completion — persist notice to DB and queue for next user message.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const paths = (detail.images || [])
        .map((img: { localPath?: string }) => img.localPath)
        .filter(Boolean);
      const pathInfo = paths.length > 0 ? `\nGenerated image file paths:\n${paths.map((p: string) => `- ${p}`).join('\n')}` : '';
      const notice = `[Image generation completed]\n- Prompt: "${detail.prompt}"\n- Aspect ratio: ${detail.aspectRatio}\n- Resolution: ${detail.resolution}${pathInfo}`;

      if (paths.length > 0) {
        setLastGeneratedImages(paths);
      }

      pendingImageNoticesRef.current.push(notice);

      const dbNotice = `[__IMAGE_GEN_NOTICE__ prompt: "${detail.prompt}", aspect ratio: ${detail.aspectRatio}, resolution: ${detail.resolution}${paths.length > 0 ? `, file path: ${paths.join(', ')}` : ''}]`;
      fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, role: 'user', content: dbNotice }),
      }).catch(() => {});
    };
    window.addEventListener('image-gen-completed', handler);
    return () => window.removeEventListener('image-gen-completed', handler);
  }, [sessionId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={compactInputOnly ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
        {!compactInputOnly ? (
          <>
            <MessageList
              messages={messages}
              streamingContent={streamingContent}
              isStreaming={isStreaming}
              toolUses={toolUses}
              toolResults={toolResults}
              reasoningSummaries={reasoningSummaries}
              streamingToolOutput={streamingToolOutput}
              statusText={statusText}
              pendingPermission={pendingPermission}
              onPermissionResponse={handlePermissionResponse}
              permissionResolved={permissionResolved}
              onForceStop={stopStreaming}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={loadEarlierMessages}
              fullWidth={fullWidth}
              hideEmptyState={hideEmptyState}
            />
            <BatchExecutionDashboard />
            <BatchContextSync />
          </>
        ) : null}
      </div>

      <TaskStatusBar banner={taskBanner} />

      <MessageInput
        onSend={sendMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={false}
        isStreaming={isStreaming}
        sessionId={sessionId}
        modelName={currentModel}
        resolvedModelName={resolvedModelName}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        onProviderModelChange={handleProviderModelChange}
        workingDirectory={effectiveWorkingDirectory}
        initialKnowledgeEnabled={initialKnowledgeEnabled}
        onInputFocus={onInputFocus}
        fullWidth={fullWidth}
      />

      <ProviderSwitchDialog
        open={switchDialogOpen}
        onOpenChange={(open) => {
          setSwitchDialogOpen(open);
          if (!open) setSwitchDialogPayload(null);
        }}
        onConfirm={() => {
          if (switchDialogPayload) {
            void executeSwitchProvider(switchDialogPayload.providerId, switchDialogPayload.model);
          }
          setSwitchDialogOpen(false);
          setSwitchDialogPayload(null);
        }}
        targetProviderName={switchDialogPayload?.providerName}
      />

      {switchError && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive shadow-lg backdrop-blur-sm">
            <span>{switchError}</span>
            <button
              type="button"
              className="ml-1 rounded p-0.5 hover:bg-destructive/20"
              onClick={() => setSwitchError(null)}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
