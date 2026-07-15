'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import type {
  ChatKnowledgeOptions,
  Message,
  MessagesResponse,
  PermissionRequestEvent,
  FileAttachment,
} from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { usePanel } from '@/hooks/usePanel';
import { useContentPanelStore } from '@/stores/content-panel';
import { consumePendingChatBootstrap } from '@/lib/chat/session-bootstrap';
import { consumeSSEStream } from '@/hooks/useSSEStream';
import { setLastGeneratedImages, transferPendingToMessage } from '@/lib/image-ref-store';
import { Button } from '@/components/ui/button';
import type { BrowserPanelTabData } from '@/types/browser';
import {
  parseBrowserContextConflict,
  type BrowserContextConflictDetails,
} from '@/lib/browser-provider/occupancy';
import { useStreamingStore } from '@/stores/streaming-store';
import { useMessagesStore } from '@/stores/messages-store';
import {
  abortChatStream,
  clearChatStreamController,
  getChatStreamController,
  registerChatStreamController,
} from '@/lib/chat-stream-controller-registry';
import {
  hasLeakedToolInvocationText,
  LEAKED_TOOL_INVOCATION_MESSAGE,
  stripLeakedToolTraceText,
} from '@/lib/chat/tool-trace-sanitizer';

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
  initialKnowledgeOptions?: ChatKnowledgeOptions;
  providerId?: string;
  browserContextId?: string;
  workingDirectoryOverride?: string;
  compactInputOnly?: boolean;
  onInputFocus?: () => void;
  fullWidth?: boolean;
  hideEmptyState?: boolean;
  chatEndpoint?: string;
  providerModelsEndpoint?: string;
  onStreamComplete?: () => void;
  onRequestedModelChange?: (model: string) => void;
  onResolvedModelChange?: (model: string) => void;
  onBrowserContextChange?: (contextId: string) => void;
  onKnowledgeOptionsChange?: (options: ChatKnowledgeOptions) => void;
}

interface BrowserContextConflictState extends BrowserContextConflictDetails {
  retryContent?: string;
  retryFiles?: FileAttachment[];
  retrySystemPromptAppend?: string;
  retryDisplayOverride?: string;
  retryKnowledgeOptions?: ChatKnowledgeOptions;
}

interface ChatBrowserPageContext {
  pageId?: string;
  url?: string;
  title?: string;
  selectedText?: string;
  text?: string;
  textLength?: number;
  readyState?: string;
  capturedAt: string;
  captureError?: string;
}

interface AutoContinueState {
  enabled: boolean;
  status: 'idle' | 'waiting' | 'running' | 'paused' | 'stopped' | 'failed';
  next_run_at: string | null;
  delay_seconds: number;
  round: number;
  max_rounds: number;
  last_summary: string;
  last_error: string;
}

const EMPTY_MESSAGES: Message[] = [];
const BROWSER_PAGE_TEXT_LIMIT = 12_000;
const BROWSER_SELECTED_TEXT_LIMIT = 2_000;
const BROWSER_PAGE_CAPTURE_TIMEOUT_MS = 3_000;

function getBrowserPanelTabData(data: unknown): BrowserPanelTabData {
  return (data as BrowserPanelTabData | undefined) || {};
}

function normalizeBrowserPageText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, limit);
}

function buildBrowserPageCaptureScript(): string {
  return `(() => {
    const maxText = ${BROWSER_PAGE_TEXT_LIMIT};
    const maxSelection = ${BROWSER_SELECTED_TEXT_LIMIT};
    const clean = (value) => String(value || '')
      .replace(/\\u0000/g, '')
      .replace(/[ \\t]+\\n/g, '\\n')
      .replace(/\\n{4,}/g, '\\n\\n\\n')
      .trim();
    const selected = clean(window.getSelection ? window.getSelection().toString() : '');
    const bodyText = clean(document.body ? document.body.innerText : '');
    return {
      url: window.location.href,
      title: document.title || '',
      selectedText: selected.slice(0, maxSelection),
      text: bodyText.slice(0, maxText),
      textLength: bodyText.length,
      readyState: document.readyState || ''
    };
  })()`;
}

function coerceBrowserPageContextValue(
  value: unknown,
  fallback: Pick<ChatBrowserPageContext, 'pageId' | 'url' | 'title' | 'capturedAt'>,
): ChatBrowserPageContext {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const url = normalizeBrowserPageText(record.url, 2_000) || fallback.url;
  const title = normalizeBrowserPageText(record.title, 500) || fallback.title;
  const selectedText = normalizeBrowserPageText(record.selectedText, BROWSER_SELECTED_TEXT_LIMIT);
  const text = normalizeBrowserPageText(record.text, BROWSER_PAGE_TEXT_LIMIT);
  const textLength = typeof record.textLength === 'number' && Number.isFinite(record.textLength)
    ? Math.max(0, Math.floor(record.textLength))
    : text.length;
  const readyState = normalizeBrowserPageText(record.readyState, 50);

  return {
    ...fallback,
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(selectedText ? { selectedText } : {}),
    ...(text ? { text } : {}),
    textLength,
    ...(readyState ? { readyState } : {}),
  };
}

async function captureActiveBrowserPageContext(): Promise<ChatBrowserPageContext | null> {
  if (typeof window === 'undefined') return null;

  const { tabs, activeTabId } = useContentPanelStore.getState();
  const activeBrowserTab = tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser');
  if (!activeBrowserTab) return null;

  const data = getBrowserPanelTabData(activeBrowserTab.data);
  const capturedAt = new Date().toISOString();
  let pageId = typeof data.pageId === 'string' ? data.pageId.trim() : '';
  let url = typeof data.url === 'string' ? data.url.trim() : '';
  let title = activeBrowserTab.title || '';
  const api = window.electronAPI?.browser;

  if (api?.getTabs) {
    try {
      const tabsResult = await api.getTabs();
      if (tabsResult.success && Array.isArray(tabsResult.tabs)) {
        const nativeTab = tabsResult.tabs.find((tab) => tab.id === pageId)
          || tabsResult.tabs.find((tab) => tab.id === tabsResult.activeTabId);
        if (nativeTab) {
          pageId = nativeTab.id || pageId;
          url = nativeTab.url || url;
          title = nativeTab.title || title;
        }
      }
    } catch (error) {
      console.warn('[ChatView] Failed to refresh browser tab metadata:', error);
    }
  }

  if (!pageId && !url) return null;
  if (url === 'about:blank') return null;

  const fallback = {
    pageId: pageId || undefined,
    url: url || undefined,
    title: title || undefined,
    capturedAt,
  };

  if (!pageId || !api?.sendCDPCommand) {
    return {
      ...fallback,
      captureError: 'Browser page text capture is unavailable.',
    };
  }

  try {
    if (api.isCDPConnected && api.connectCDP) {
      const status = await api.isCDPConnected(pageId);
      if (!status.success || !status.connected) {
        const connected = await api.connectCDP(pageId);
        if (!connected.success) {
          throw new Error(connected.error || 'Failed to connect browser page');
        }
      }
    } else if (api.connectCDP) {
      const connected = await api.connectCDP(pageId);
      if (!connected.success) {
        throw new Error(connected.error || 'Failed to connect browser page');
      }
    }

    const evaluated = await api.sendCDPCommand(pageId, 'Runtime.evaluate', {
      expression: buildBrowserPageCaptureScript(),
      awaitPromise: true,
      returnByValue: true,
    });
    if (!evaluated.success) {
      throw new Error(evaluated.error || 'Failed to evaluate browser page');
    }

    const value = (evaluated.result as { result?: { value?: unknown } } | undefined)?.result?.value;
    return coerceBrowserPageContextValue(value, fallback);
  } catch (error) {
    return {
      ...fallback,
      captureError: error instanceof Error ? error.message : 'Failed to capture browser page text.',
    };
  }
}

function captureActiveBrowserPageContextWithTimeout(): Promise<ChatBrowserPageContext | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, BROWSER_PAGE_CAPTURE_TIMEOUT_MS);

    captureActiveBrowserPageContext()
      .then((context) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(context);
      })
      .catch((error) => {
        console.warn('[ChatView] Failed to capture active browser page context:', error);
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      });
  });
}

function getInitialKnowledgeOptions(
  initialKnowledgeOptions: ChatKnowledgeOptions | undefined,
  initialKnowledgeEnabled: boolean,
): ChatKnowledgeOptions {
  return initialKnowledgeOptions || { enabled: initialKnowledgeEnabled, tagIds: [] };
}

async function getBrowserBridgeHeaders(browserContextId?: string): Promise<Record<string, string>> {
  if (typeof window === 'undefined' || !window.electronAPI?.browser?.getBridgeConfig) {
    return browserContextId ? { 'x-lumos-browser-context-id': browserContextId } : {};
  }

  try {
    const bridge = await window.electronAPI.browser.getBridgeConfig();
    if (!bridge?.success) return {};

    const headers: Record<string, string> = {};
    if (bridge.url) headers['x-lumos-browser-bridge-url'] = bridge.url;
    if (bridge.token) headers['x-lumos-browser-bridge-token'] = bridge.token;
    if (browserContextId) headers['x-lumos-browser-context-id'] = browserContextId;
    return headers;
  } catch {
    return browserContextId ? { 'x-lumos-browser-context-id': browserContextId } : {};
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

function formatAutoContinueStatus(state: AutoContinueState): string {
  switch (state.status) {
    case 'waiting':
      return '等待下一轮';
    case 'running':
      return '运行中';
    case 'failed':
      return '失败';
    case 'stopped':
      return '已停止';
    case 'paused':
      return '已暂停';
    default:
      return '空闲';
  }
}

function formatAutoContinueTime(value: string | null): string {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

export function ChatView({
  sessionId,
  initialMessages = EMPTY_MESSAGES,
  initialHasMore = false,
  modelName,
  resolvedModelName,
  initialKnowledgeEnabled = false,
  initialKnowledgeOptions,
  providerId,
  browserContextId = 'embedded:default',
  workingDirectoryOverride,
  compactInputOnly = false,
  onInputFocus,
  fullWidth = false,
  hideEmptyState = false,
  chatEndpoint,
  providerModelsEndpoint,
  onStreamComplete,
  onRequestedModelChange,
  onResolvedModelChange,
  onBrowserContextChange,
  onKnowledgeOptionsChange,
}: ChatViewProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { setStreamingSessionId, workingDirectory, setPendingApprovalSessionId, contentPanelOpen } = usePanel();
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
  const [currentModel, setCurrentModel] = useState(modelName || '');
  const [currentProviderId, setCurrentProviderId] = useState(providerId || '');
  const [currentKnowledgeOptions, setCurrentKnowledgeOptions] = useState<ChatKnowledgeOptions>(
    () => getInitialKnowledgeOptions(initialKnowledgeOptions, initialKnowledgeEnabled),
  );
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(
    () => cachedStreamingState?.pendingPermission || null
  );
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | null>(
    () => cachedStreamingState?.permissionResolved || null
  );
  const [streamingToolOutput, setStreamingToolOutput] = useState(() => cachedStreamingState?.streamingToolOutput || '');
  const [browserConflict, setBrowserConflict] = useState<BrowserContextConflictState | null>(null);
  const [browserConflictAction, setBrowserConflictAction] = useState<'release' | 'retry' | 'embedded' | null>(null);
  const [autoContinue, setAutoContinue] = useState<AutoContinueState | null>(null);
  const [stoppingAutoContinue, setStoppingAutoContinue] = useState(false);
  const mode = 'code';

  const messagesRef = useRef<Message[]>(sourceMessages);
  const hasMoreRef = useRef(sourceHasMore);
  const toolTimeoutRef = useRef<{ toolName: string; elapsedSeconds: number } | null>(null);
  const idleMemoryTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sendInFlightRef = useRef(false);
  const isStreamingRef = useRef(false);
  // Wall-clock guard: covers the hairline window between sendInFlightRef going
  // false and isStreamingRef catching up to React state. SSE callbacks within
  // SEND_QUIESCE_MS of the last local send start are skipped.
  const lastLocalSendAtRef = useRef(0);
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
  // 团队会话:绑定后显示团队徽标;空会话(还没发消息)可现场选团队。
  const [teamId, setTeamId] = useState('');
  const [teamName, setTeamName] = useState('');
  // 服务端占用(上一轮还在后台跑,本地无流):亮停止按钮,用户可终止后台执行
  const [serverBusy, setServerBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/chat/sessions/${sessionId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as { session?: { team_id?: string | null; runtime_status?: string } };
        if (!cancelled && data.session?.runtime_status === 'running') setServerBusy(true);
        const boundTeamId = data.session?.team_id;
        if (!boundTeamId) { if (!cancelled) { setTeamId(''); setTeamName(''); } return; }
        const teamRes = await fetch(`/api/teams/${boundTeamId}`, { cache: 'no-store' });
        const teamData = teamRes.ok ? await teamRes.json() as { team?: { name?: string } } : null;
        if (!cancelled) { setTeamId(boundTeamId); setTeamName(teamData?.team?.name || '团队'); }
      } catch { /* 徽标缺失不影响聊天 */ }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const handleTeamChange = useCallback(async (nextTeamId: string, nextTeamName: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: nextTeamId }),
      });
      if (res.ok) { setTeamId(nextTeamId); setTeamName(nextTeamName); }
    } catch { /* 绑定失败保持原状 */ }
  }, [sessionId]);

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

  const refreshAutoContinue = useCallback(async () => {
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/auto-continue`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await response.json() as { auto_continue?: AutoContinueState | null };
      setAutoContinue(data.auto_continue || null);
    } catch {
      // Best effort only.
    }
  }, [sessionId]);

  const stopAutoContinue = useCallback(async () => {
    if (!sessionId || stoppingAutoContinue) return;
    setStoppingAutoContinue(true);
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/auto-continue`, {
        method: 'DELETE',
      });
      if (response.ok) {
        const data = await response.json() as { auto_continue?: AutoContinueState | null };
        setAutoContinue(data.auto_continue || null);
      }
    } finally {
      setStoppingAutoContinue(false);
    }
  }, [sessionId, stoppingAutoContinue]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    void refreshAutoContinue();
  }, [refreshAutoContinue]);

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
  }, [clearIdleMemoryTimer]);

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

  const handleProviderModelChange = useCallback(async (newProviderId: string, model: string) => {
    const nextProviderId = newProviderId.trim();
    const currentProvider = currentProviderId.trim();
    const nextModel = model.trim();
    const currentModelValue = currentModel.trim();
    const providerChanged = Boolean(nextProviderId && nextProviderId !== currentProvider);
    const modelChanged = Boolean(nextModel && nextModel !== currentModelValue);

    if (providerChanged && isStreaming) {
      setSwitchError('AI 回复中，暂时不能切换');
      return;
    }

    setSwitchError(null);
    setCurrentProviderId(nextProviderId);
    setCurrentModel(nextModel);
    onRequestedModelChange?.(nextModel);

    // 所有 provider 都走同一个 new-api 网关（base_url / key 统一），
    // 切换本质上只是把后续请求挂到不同的 model 上，不需要 fork 会话。
    if ((providerChanged || modelChanged) && sessionId) {
      try {
        const response = await fetch(`/api/chat/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider_id: nextProviderId, model: nextModel }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error || '切换失败');
        }
      } catch (error) {
        setSwitchError(error instanceof Error ? error.message : '切换失败');
      }
    }
  }, [currentModel, currentProviderId, isStreaming, onRequestedModelChange, sessionId]);

  const handleKnowledgeOptionsChange = useCallback((options: ChatKnowledgeOptions) => {
    setCurrentKnowledgeOptions(options);
    onKnowledgeOptionsChange?.(options);
    if (!sessionId) {
      return;
    }
    fetch(`/api/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knowledge_enabled: options.enabled,
        knowledge_tag_ids: options.tagIds,
        knowledge_overrides: options.overrides || {},
      }),
    }).catch(() => {
      // Send-message POST also persists these options; this PATCH keeps toggles sticky before sending.
    });
  }, [onKnowledgeOptionsChange, sessionId]);

  const recordBrowserConflict = useCallback((
    raw: unknown,
    retry: Omit<BrowserContextConflictState, keyof BrowserContextConflictDetails>,
  ) => {
    const conflict = parseBrowserContextConflict(raw, browserContextId);
    if (!conflict || conflict.contextId === 'embedded:default') {
      return;
    }
    setBrowserConflict({
      ...conflict,
      ...retry,
    });
  }, [browserContextId]);

  useEffect(() => {
    setBrowserConflict((current) => {
      if (!current || current.contextId === browserContextId) {
        return current;
      }
      return null;
    });
  }, [browserContextId]);

  const releaseBrowserConflict = useCallback(async (conflict: BrowserContextConflictState) => {
    const response = await fetch('/api/browser-providers/runtime-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_id: conflict.contextId }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || '释放浏览器占用失败');
    }
  }, []);

  const handleReleaseBrowserConflict = useCallback(async () => {
    if (!browserConflict || browserConflictAction) return;
    setBrowserConflictAction('release');
    setSwitchError(null);
    try {
      await releaseBrowserConflict(browserConflict);
      setBrowserConflict(null);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : '释放浏览器占用失败');
    } finally {
      setBrowserConflictAction(null);
    }
  }, [browserConflict, browserConflictAction, releaseBrowserConflict]);

  const handleReleaseAndRetryBrowserConflict = useCallback(async () => {
    if (!browserConflict || browserConflictAction || isStreaming) return;
    setBrowserConflictAction('retry');
    setSwitchError(null);
    try {
      await releaseBrowserConflict(browserConflict);
      const retryContent = browserConflict.retryContent;
      setBrowserConflict(null);
      if (retryContent) {
        window.setTimeout(() => {
          sendMessageRef.current?.(
            retryContent,
            browserConflict.retryFiles,
            browserConflict.retrySystemPromptAppend,
            browserConflict.retryDisplayOverride,
            browserConflict.retryKnowledgeOptions,
          );
        }, 100);
      }
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : '释放浏览器占用失败');
    } finally {
      setBrowserConflictAction(null);
    }
  }, [browserConflict, browserConflictAction, isStreaming, releaseBrowserConflict]);

  const handleSwitchBrowserConflictToEmbedded = useCallback(async () => {
    if (browserConflictAction || isStreaming) return;
    setBrowserConflictAction('embedded');
    setSwitchError(null);
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browser_context_id: 'embedded:default' }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || '切换到内置浏览器失败');
      }
      onBrowserContextChange?.('embedded:default');
      setBrowserConflict(null);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : '切换到内置浏览器失败');
    } finally {
      setBrowserConflictAction(null);
    }
  }, [browserConflictAction, isStreaming, onBrowserContextChange, sessionId]);

  // Cleanup on unmount - but don't abort streaming to allow background completion
  useEffect(() => {
    return () => {
      clearIdleMemoryTimer();
    };
  }, [clearIdleMemoryTimer]);

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
    setCurrentKnowledgeOptions(getInitialKnowledgeOptions(initialKnowledgeOptions, initialKnowledgeEnabled));
  }, [initialKnowledgeEnabled, initialKnowledgeOptions]);

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

  // External writers (IM 入站 / scheduler / workflow assistant) call db.addMessage
  // which emits `task:updated` on the server task-event-bus. We subscribe to the
  // per-session SSE feed and tail-reconcile against the server's authoritative
  // message list. Local streaming turns own their own surface and are skipped.
  //
  // Reconciliation rule (handles optimistic-local-tail case):
  //   maxRowId = max _rowid among existing messages that HAVE a _rowid
  //   keepIdx  = index of the last existing message that has a _rowid
  //   server-side messages with _rowid > maxRowId REPLACE everything after keepIdx
  //
  // This makes the post-local-turn case (optimistic messages with no _rowid at
  // the tail, since they were appended client-side) reconcile correctly: the
  // optimistic tail is replaced by the DB-persisted versions, after which
  // ordinary tail-append works.
  const SEND_QUIESCE_MS = 3000;
  const refreshLatestMessages = useCallback(async () => {
    if (isStreamingRef.current || sendInFlightRef.current) return;
    if (loadingMoreRef.current) return;
    if (Date.now() - lastLocalSendAtRef.current < SEND_QUIESCE_MS) return;
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=100`);
      if (!res.ok) return;
      const data: MessagesResponse = await res.json();
      const existing = messagesRef.current;
      let maxRowId = 0;
      let keepIdx = -1;
      for (let i = 0; i < existing.length; i++) {
        const r = (existing[i] as Message & { _rowid?: number })._rowid;
        if (typeof r === 'number') {
          if (r > maxRowId) maxRowId = r;
          keepIdx = i;
        }
      }
      const serverTail = data.messages.filter((m) => {
        const r = (m as Message & { _rowid?: number })._rowid ?? 0;
        return r > maxRowId;
      });
      // Nothing new on the server AND no optimistic tail to reconcile → no-op.
      if (serverTail.length === 0 && keepIdx === existing.length - 1) return;
      const next = [...existing.slice(0, keepIdx + 1), ...serverTail];
      messagesRef.current = next;
      setMessages(next);
      updateMessagesSession(sessionId, {
        messages: next,
        hasMore: hasMoreRef.current,
        loading: false,
        error: null,
      });
    } catch {
      // Browser will auto-reconnect SSE; next event triggers another refresh.
    }
  }, [sessionId, updateMessagesSession]);

  useEffect(() => {
    if (!sessionId) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/sessions/${sessionId}/events`);
    } catch {
      return;
    }
    const onTaskUpdated = () => {
      void refreshLatestMessages();
      void refreshAutoContinue();
    };
    // Server pushes a `hello` on connect — use it to align with any writes that
    // landed between SSR/initial-load and SSE connect.
    const onHello = () => {
      void refreshLatestMessages();
      void refreshAutoContinue();
    };
    es.addEventListener('task:updated', onTaskUpdated);
    es.addEventListener('hello', onHello);
    return () => {
      es?.removeEventListener('task:updated', onTaskUpdated);
      es?.removeEventListener('hello', onHello);
      es?.close();
    };
  }, [sessionId, refreshLatestMessages, refreshAutoContinue]);

  const stopStreaming = useCallback(() => {
    // 服务端中断:断前端 SSE 停不掉后台执行(团队长任务尤甚),必须让 SDK 会话真正终止。
    // fire-and-forget,不阻塞本地 UI 收尾。
    void fetch(`/api/chat/sessions/${sessionId}/stop`, { method: 'POST' }).catch(() => {});
    setServerBusy(false);
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
      if (isStreaming || sendInFlightRef.current) return;
      sendInFlightRef.current = true;
      lastLocalSendAtRef.current = Date.now();
      clearIdleMemoryTimer();
      setBrowserConflict(null);

      const displayUserContent = displayOverride || content;
      const conflictRetry = {
        retryContent: content,
        retryFiles: files,
        retrySystemPromptAppend: systemPromptAppend,
        retryDisplayOverride: displayOverride,
        retryKnowledgeOptions: knowledgeOptions,
      };

      let displayContent = displayUserContent;
      if (files && files.length > 0) {
        const fileMeta = files.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          size: f.size,
          ...(f.filePath ? { filePath: f.filePath } : {}),
          ...(f.data && f.size <= 10 * 1024 * 1024 && !f.type.startsWith('audio/')
            ? { data: f.data }
            : {}),
        }));
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

      // 对齐到 chat/route.ts 的 toolTimeoutSeconds 默认值，避免合法的长任务
      // (如图片生成 ~6 分钟) 被客户端 idle 检查提前杀掉。
      const STREAM_IDLE_TIMEOUT_MS = 900_000;
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
      let leakedToolInvocationSeen = false;

      let effectiveContent = content;
      if (pendingImageNoticesRef.current.length > 0) {
        const notices = pendingImageNoticesRef.current.join('\n\n');
        pendingImageNoticesRef.current = [];
        effectiveContent = `${notices}\n\n---\n\n${content}`;
      }

      try {
        const bridgeHeaders = await getBrowserBridgeHeaders(browserContextId);
        const browserPageContext = contentPanelOpen
          ? await captureActiveBrowserPageContextWithTimeout()
          : null;
        const apiEndpoint = chatEndpoint || (sessionId === 'capability-authoring' ? '/api/capabilities/chat' : '/api/chat');

        // 为 capability-authoring 构建消息历史
        const requestBody: Record<string, unknown> = {
          session_id: sessionId,
          content: effectiveContent,
          mode,
          model: currentModel,
          provider_id: currentProviderId,
          knowledge_enabled: knowledgeOptions?.enabled === true,
          knowledge_tag_ids: knowledgeOptions?.tagIds ?? [],
          ...(knowledgeOptions?.overrides && Object.keys(knowledgeOptions.overrides).length > 0
            ? { knowledge_overrides: knowledgeOptions.overrides }
            : {}),
          ...(files && files.length > 0 ? { files } : {}),
          ...(systemPromptAppend ? { systemPromptAppend } : {}),
          ...(browserPageContext ? { browser_page_context: browserPageContext } : {}),
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
          // 会话被上一轮占用(如团队长任务还在跑):亮出停止按钮让用户能终止,而不是干瞪眼
          if (err.code === 'SESSION_BUSY') setServerBusy(true);
          throw new Error(err.error || 'Failed to send message');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const result = await consumeSSEStream(reader, {
          onText: (acc) => {
            markActive();
            const isFirstVisibleContent = accumulated.length === 0;
            leakedToolInvocationSeen = leakedToolInvocationSeen || hasLeakedToolInvocationText(acc);
            const visibleAcc = stripLeakedToolTraceText(acc);
            accumulated = acc;
            accumulatedRef.current = acc;
            setStreamingContent(visibleAcc);
            if (isFirstVisibleContent) {
              setStatusText(undefined);
            }
            const nextStreamingState: {
              content: string;
              status: 'streaming';
              statusText?: string;
            } = {
              content: visibleAcc,
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

          },
          onToolResult: (res) => {
            markActive();
            setStatusText(undefined);
            setStreamingToolOutput('');
            recordBrowserConflict(res.content, conflictRetry);
            setToolResults((prev) => {
              if (prev.some((r) => r.tool_use_id === res.tool_use_id)) return prev;
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

        const leakedToolInvocation = leakedToolInvocationSeen || hasLeakedToolInvocationText(accumulated);
        const sanitizedAccumulated = stripLeakedToolTraceText(accumulated).trim();
        const leakedToolInvocationError = leakedToolInvocation
          ? `**Error:** ${LEAKED_TOOL_INVOCATION_MESSAGE}`
          : '';
        if (leakedToolInvocation) {
          shouldMarkStreamError = true;
        }
        let messageContent = sanitizedAccumulated;
        if (hasStructuredBlocks) {
          const contentBlocks: Array<Record<string, unknown>> = [];
          for (const summary of finalReasoningSummaries) {
            contentBlocks.push({ type: 'reasoning', summary });
          }
          for (const tu of finalToolUses) {
            contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
            const tr = finalToolResults.find((r) => r.tool_use_id === tu.id);
            if (tr) {
              contentBlocks.push({
                type: 'tool_result',
                tool_use_id: tr.tool_use_id,
                content: tr.content,
                is_error: tr.is_error || false,
              });
            }
          }
          if (sanitizedAccumulated) {
            contentBlocks.push({ type: 'text', text: sanitizedAccumulated });
          }
          if (leakedToolInvocationError) {
            contentBlocks.push({ type: 'text', text: leakedToolInvocationError });
          }
          messageContent = JSON.stringify(contentBlocks);
        } else if (leakedToolInvocationError) {
          messageContent = sanitizedAccumulated
            ? `${sanitizedAccumulated}\n\n${leakedToolInvocationError}`
            : leakedToolInvocationError;
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
          recordBrowserConflict(errMsg, conflictRetry);
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
        sendInFlightRef.current = false;
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
        onStreamComplete?.();
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
      browserContextId,
      clearIdleMemoryTimer,
      chatEndpoint,
      completeStreamingSession,
      contentPanelOpen,
      currentModel,
      currentProviderId,
      errorStreamingSession,
      isStreaming,
      mode,
      onResolvedModelChange,
      onStreamComplete,
      pathname,
      recordBrowserConflict,
      resetStreamingUi,
      scheduleIdleMemoryTrigger,
      refreshSessionMetadata,
      sessionId,
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

    if (pendingBootstrap.knowledgeOptions) {
      handleKnowledgeOptionsChange(pendingBootstrap.knowledgeOptions);
    }

    void sendMessage(
      pendingBootstrap.content,
      pendingBootstrap.files,
      pendingBootstrap.systemPromptAppend,
      pendingBootstrap.displayOverride,
      pendingBootstrap.knowledgeOptions,
    );
  }, [handleKnowledgeOptionsChange, sendMessage, sessionId]);

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
              pinStreamingStart
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
          </>
        ) : null}
      </div>

      {browserConflict ? (
        <div className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">浏览器正在被占用</p>
              <p className="mt-0.5 truncate text-xs text-amber-900/70 dark:text-amber-100/70">
                {browserConflict.message}
                {browserConflict.ownerId ? ` 来源: ${browserConflict.ownerId}` : ''}
                {browserConflict.waitedMs !== undefined && !browserConflict.message.includes('已等待')
                  ? ` · 已等待 ${Math.ceil(browserConflict.waitedMs / 1000)} 秒`
                  : ''}
                {browserConflict.retryAfterMs !== undefined && browserConflict.retryAfterMs > 0
                  ? ` · 建议 ${Math.ceil(browserConflict.retryAfterMs / 1000)} 秒后重试`
                  : ''}
                {browserConflict.expiresAt ? ` · 自动过期 ${new Date(browserConflict.expiresAt).toLocaleTimeString()}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReleaseBrowserConflict}
                disabled={Boolean(browserConflictAction)}
              >
                {browserConflictAction === 'release' ? '释放中' : '释放占用'}
              </Button>
              {browserConflict.retryContent ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleReleaseAndRetryBrowserConflict}
                  disabled={Boolean(browserConflictAction) || isStreaming}
                >
                  {browserConflictAction === 'retry' ? '重试中' : '释放并重试'}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSwitchBrowserConflictToEmbedded}
                disabled={Boolean(browserConflictAction) || isStreaming}
              >
                {browserConflictAction === 'embedded' ? '切换中' : '切回内置'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setBrowserConflict(null)}
                disabled={Boolean(browserConflictAction)}
              >
                关闭
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {autoContinue && (autoContinue.enabled || autoContinue.status !== 'idle') ? (
        <div className="border-t border-sky-500/20 bg-sky-500/10 px-4 py-3">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-sky-950 dark:text-sky-100">
                自动续跑：{formatAutoContinueStatus(autoContinue)}
              </p>
              <p className="mt-0.5 truncate text-xs text-sky-950/70 dark:text-sky-100/70">
                已执行 {autoContinue.round}/{autoContinue.max_rounds} 轮
                {autoContinue.next_run_at ? ` · 下次 ${formatAutoContinueTime(autoContinue.next_run_at)}` : ''}
                {autoContinue.last_summary ? ` · ${autoContinue.last_summary}` : ''}
                {autoContinue.last_error ? ` · ${autoContinue.last_error}` : ''}
              </p>
            </div>
            {autoContinue.enabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={stopAutoContinue}
                disabled={stoppingAutoContinue}
              >
                {stoppingAutoContinue ? '停止中' : '停止自动续跑'}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <MessageInput
        onSend={sendMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={false}
        isStreaming={isStreaming || serverBusy}
        sessionId={sessionId}
        modelName={currentModel}
        resolvedModelName={resolvedModelName}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        onProviderModelChange={handleProviderModelChange}
        workingDirectory={effectiveWorkingDirectory}
        initialKnowledgeEnabled={initialKnowledgeEnabled}
        initialKnowledgeOptions={currentKnowledgeOptions}
        onKnowledgeOptionsChange={handleKnowledgeOptionsChange}
        onInputFocus={onInputFocus}
        fullWidth={fullWidth}
        providerModelsEndpoint={providerModelsEndpoint}
        teamId={teamId}
        teamName={teamName}
        onTeamChange={handleTeamChange}
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
