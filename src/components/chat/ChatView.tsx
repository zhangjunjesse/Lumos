'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Message, MessagesResponse, PermissionRequestEvent, FileAttachment } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { usePanel } from '@/hooks/usePanel';
import { consumeSSEStream } from '@/hooks/useSSEStream';
import { BatchExecutionDashboard, BatchContextSync } from './batch-image-gen';
import { setLastGeneratedImages, transferPendingToMessage } from '@/lib/image-ref-store';
import { extractChromeMcpUrl, openBrowserUrlInPanel } from '@/lib/chrome-mcp';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
}

interface ChatViewProps {
  sessionId: string;
  initialMessages?: Message[];
  initialHasMore?: boolean;
  modelName?: string;
  initialMode?: string;
  providerId?: string;
  workingDirectoryOverride?: string;
  compactInputOnly?: boolean;
  onInputFocus?: () => void;
  fullWidth?: boolean;
  hideEmptyState?: boolean;
}

interface MemoryIdleTriggerConfig {
  enabled: boolean;
  timeoutMs: number;
}

const DEFAULT_MEMORY_IDLE_TIMEOUT_MS = 120_000;
const MIN_MEMORY_IDLE_TIMEOUT_MS = 10_000;

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

export function ChatView({
  sessionId,
  initialMessages = [],
  initialHasMore = false,
  modelName,
  initialMode,
  providerId,
  workingDirectoryOverride,
  compactInputOnly = false,
  onInputFocus,
  fullWidth = false,
  hideEmptyState = false,
}: ChatViewProps) {
  const { t } = useTranslation();
  const { setStreamingSessionId, workingDirectory, setContentPanelOpen, setPendingApprovalSessionId } = usePanel();
  const effectiveWorkingDirectory = workingDirectoryOverride || workingDirectory;
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([]);
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([]);
  const [statusText, setStatusText] = useState<string | undefined>();
  const [mode, setMode] = useState(initialMode || 'code');
  const [currentModel, setCurrentModel] = useState(modelName || (typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') : null) || 'sonnet');
  const [currentProviderId, setCurrentProviderId] = useState(providerId || (typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') : null) || '');
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(null);
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | null>(null);
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [memoryIdleConfig, setMemoryIdleConfig] = useState<MemoryIdleTriggerConfig>({
    enabled: true,
    timeoutMs: DEFAULT_MEMORY_IDLE_TIMEOUT_MS,
  });
  const toolTimeoutRef = useRef<{ toolName: string; elapsedSeconds: number } | null>(null);
  const idleMemoryTimerRef = useRef<number | null>(null);

  const handleModeChange = useCallback((newMode: string) => {
    setMode(newMode);
    // Persist mode to database and notify chat list
    if (sessionId) {
      fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      }).then(() => {
        window.dispatchEvent(new CustomEvent('session-updated', { detail: { id: sessionId } }));
      }).catch(() => { /* silent */ });

      // Try to switch SDK permission mode in real-time (works if streaming)
      fetch('/api/chat/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mode: newMode }),
      }).catch(() => { /* silent — will apply on next message */ });
    }
  }, [sessionId]);

  const handleProviderModelChange = useCallback((newProviderId: string, model: string) => {
    setCurrentProviderId(newProviderId);
    setCurrentModel(model);
  }, []);

  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Abort active stream on unmount (e.g., session switch via key={id} remount).
  // This triggers the existing server-side cleanup chain:
  //   fetch abort → request.signal 'abort' → route abortController.abort()
  //   → collectStreamResponse catch block saves partial message to DB
  //   → permission-registry abort handler auto-denies pending permissions
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      clearIdleMemoryTimer();
      setStreamingSessionId('');
      setPendingApprovalSessionId('');
    };
  }, [clearIdleMemoryTimer, setStreamingSessionId, setPendingApprovalSessionId]);

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

  // Ref to keep accumulated streaming content in sync regardless of React batching
  const accumulatedRef = useRef('');
  // Refs to track tool data reliably across closures (state reads can be stale)
  const toolUsesRef = useRef<ToolUseInfo[]>([]);
  const toolResultsRef = useRef<ToolResultInfo[]>([]);
  // Ref for sendMessage to allow self-referencing in timeout auto-retry without circular deps
  const sendMessageRef = useRef<(content: string, files?: FileAttachment[]) => Promise<void>>(undefined);
  // Pending image generation notices — flushed into the next user message so the LLM knows about generated images
  const pendingImageNoticesRef = useRef<string[]>([]);

  // Re-sync streaming content when the window regains visibility (Electron/browser tab switch)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && accumulatedRef.current) {
        setStreamingContent(accumulatedRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Also handle Electron-specific focus events
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, []);

  function isTempMessageId(id: string): boolean {
    return id.startsWith('temp-');
  }

  // Keep local messages in sync with server-provided messages
  // when not actively streaming. This allows external updates
  // (e.g. Feishu-originated messages written to DB) to appear
  // in the UI without manual reload.
  // Guard: if local list contains optimistic temp messages and parent data
  // is clearly behind (fewer rows), do not overwrite to avoid "disappear then reappear".
  useEffect(() => {
    if (isStreaming) return;

    setMessages((prev) => {
      const localHasTemp = prev.some((msg) => isTempMessageId(msg.id));
      if (localHasTemp && initialMessages.length < prev.length) {
        return prev;
      }
      return initialMessages;
    });
  }, [initialMessages, isStreaming]);

  // Sync mode when session data loads
  useEffect(() => {
    if (initialMode) {
      setMode(initialMode);
    }
  }, [initialMode]);

  // Sync hasMore when initial data loads
  useEffect(() => {
    setHasMore(initialHasMore);
  }, [initialHasMore]);

  const loadEarlierMessages = useCallback(async () => {
    // Use ref as atomic lock to prevent double-fetch from rapid clicks
    if (loadingMoreRef.current || !hasMore || messages.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      // Use _rowid of the earliest message as cursor
      const earliest = messages[0];
      const earliestRowId = (earliest as Message & { _rowid?: number })._rowid;
      if (!earliestRowId) return;
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=100&before=${earliestRowId}`);
      if (!res.ok) return;
      const data: MessagesResponse = await res.json();
      setHasMore(data.hasMore ?? false);
      if (data.messages.length > 0) {
        setMessages(prev => [...data.messages, ...prev]);
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [sessionId, messages, hasMore]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handlePermissionResponse = useCallback(async (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>) => {
    if (!pendingPermission) return;

    const body: { permissionRequestId: string; decision: { behavior: 'allow'; updatedPermissions?: unknown[]; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message?: string } } = {
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

    setPermissionResolved(decision === 'deny' ? 'deny' : 'allow');
    setPendingApprovalSessionId('');

    try {
      await fetch('/api/chat/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Best effort - the stream will handle timeout
    }

    // Clear permission state after a short delay so user sees the feedback.
    // Only clear if no new permission request has arrived in the meantime.
    const answeredId = pendingPermission.permissionRequestId;
    setTimeout(() => {
      setPendingPermission((current) => {
        if (current?.permissionRequestId === answeredId) {
          // Same request — safe to clear both
          setPermissionResolved(null);
          return null;
        }
        return current; // A new request arrived — keep it
      });
    }, 1000);
  }, [pendingPermission, setPendingApprovalSessionId]);

  const sendMessage = useCallback(
    async (
      content: string,
      files?: FileAttachment[],
      systemPromptAppend?: string,
      displayOverride?: string,
    ) => {
      if (isStreaming) return;
      clearIdleMemoryTimer();

      // Use displayOverride for UI if provided (e.g. image-gen skill injection hides the skill prompt)
      const displayUserContent = displayOverride || content;

      // Build display content: embed file metadata as HTML comment for MessageItem to parse
      let displayContent = displayUserContent;
      if (files && files.length > 0) {
        const fileMeta = files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data }));
        displayContent = `<!--files:${JSON.stringify(fileMeta)}-->${displayUserContent}`;
      }

      // Optimistic: add user message to UI immediately
      const userMessage: Message = {
        id: 'temp-' + Date.now(),
        session_id: sessionId,
        role: 'user',
        content: displayContent,
        created_at: new Date().toISOString(),
        token_usage: null,
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setStreamingSessionId(sessionId);
      setStreamingContent('');
      accumulatedRef.current = '';
      setToolUses([]);
      setToolResults([]);
      setStatusText(undefined);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let accumulated = '';
      let shouldScheduleIdleTrigger = false;

      // Stream idle timeout: abort if no SSE events arrive for this duration.
      // Set slightly above the 5-minute permission timeout (300s) to avoid races.
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

      // Flush any pending image generation notices into the prompt so
      // the LLM (especially in SDK resume mode) knows about previously generated images.
      let effectiveContent = content;
      if (pendingImageNoticesRef.current.length > 0) {
        const notices = pendingImageNoticesRef.current.join('\n\n');
        pendingImageNoticesRef.current = [];
        effectiveContent = `${notices}\n\n---\n\n${content}`;
      }

      try {
        const bridgeHeaders = await getBrowserBridgeHeaders();
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...bridgeHeaders,
          },
          body: JSON.stringify({
            session_id: sessionId,
            content: effectiveContent,
            mode,
            model: currentModel,
            provider_id: currentProviderId,
            ...(files && files.length > 0 ? { files } : {}),
            ...(systemPromptAppend ? { systemPromptAppend } : {}),
          }),
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
            accumulated = acc;
            accumulatedRef.current = acc;
            setStreamingContent(acc);
          },
          onToolUse: (tool) => {
            markActive();
            setStreamingToolOutput('');
            setToolUses((prev) => {
              if (prev.some((t) => t.id === tool.id)) return prev;
              const next = [...prev, tool];
              toolUsesRef.current = next;
              return next;
            });

            const browserUrl = extractChromeMcpUrl(tool.name, tool.input);
            // Open the right-side browser tab as soon as the tool emits a URL.
            // The Electron bridge can later attach a stable pageId for the same tab.
            if (browserUrl) {
              setContentPanelOpen(true);
              openBrowserUrlInPanel(browserUrl);
            }
          },
          onToolResult: (res) => {
            markActive();
            setStreamingToolOutput('');
            setToolResults((prev) => {
              const next = [...prev, res];
              toolResultsRef.current = next;
              return next;
            });
            // Refresh file tree after each tool completes — file writes,
            // deletions, and other FS operations are done via tools.
            window.dispatchEvent(new Event('refresh-file-tree'));
          },
          onToolOutput: (data) => {
            markActive();
            setStreamingToolOutput((prev) => {
              const next = prev + (prev ? '\n' : '') + data;
              return next.length > 5000 ? next.slice(-5000) : next;
            });
          },
          onToolProgress: (toolName, elapsed) => {
            markActive();
            setStatusText(`Running ${toolName}... (${elapsed}s)`);
          },
          onStatus: (text) => {
            markActive();
            if (text?.startsWith('Connected (')) {
              setStatusText(text);
              setTimeout(() => setStatusText(undefined), 2000);
            } else {
              setStatusText(text);
            }
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
          },
          onToolTimeout: (toolName, elapsedSeconds) => {
            markActive();
            toolTimeoutRef.current = { toolName, elapsedSeconds };
          },
          onModeChanged: (sdkMode) => {
            markActive();
            // Map SDK permissionMode to UI mode
            const uiMode = sdkMode === 'plan' ? 'plan' : 'code';
            handleModeChange(uiMode);
          },
          onError: (acc) => {
            markActive();
            accumulated = acc;
            accumulatedRef.current = acc;
            setStreamingContent(acc);
          },
        });

        accumulated = result.accumulated;

        // Build the assistant message content.
        // When tools were used, serialize as a JSON content-blocks array
        // (same format the backend API route stores), so MessageItem's
        // parseToolBlocks() can render tool UI from history.
        const finalToolUses = toolUsesRef.current;
        const finalToolResults = toolResultsRef.current;
        const hasTools = finalToolUses.length > 0 || finalToolResults.length > 0;

        let messageContent = accumulated.trim();
        if (hasTools && messageContent) {
          const contentBlocks: Array<Record<string, unknown>> = [];
          if (accumulated.trim()) {
            contentBlocks.push({ type: 'text', text: accumulated.trim() });
          }
          for (const tu of finalToolUses) {
            contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
            const tr = finalToolResults.find(r => r.tool_use_id === tu.id);
            if (tr) {
              contentBlocks.push({ type: 'tool_result', tool_use_id: tr.tool_use_id, content: tr.content });
            }
          }
          messageContent = JSON.stringify(contentBlocks);
        }

        // Add the assistant message to the list
        if (messageContent) {
          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: sessionId,
            role: 'assistant',
            content: messageContent,
            created_at: new Date().toISOString(),
            token_usage: result.tokenUsage ? JSON.stringify(result.tokenUsage) : null,
          };
          // Transfer pending reference images to this message ID so MessageItem can
          // retrieve them. StreamingMessage uses __pending__ directly, but once the
          // message transitions to MessageItem, it's keyed by message.id.
          transferPendingToMessage(assistantMessage.id);

          setMessages((prev) => [...prev, assistantMessage]);
          shouldScheduleIdleTrigger = true;
        }
      } catch (error) {
        clearInterval(idleCheckTimer);

        if (error instanceof DOMException && error.name === 'AbortError') {
          // Stream idle timeout — no SSE events for too long
          if (isIdleTimeout) {
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
            setMessages((prev) => [...prev, errMessage]);
          } else {
            const timeoutInfo = toolTimeoutRef.current;
            if (timeoutInfo) {
              // Tool execution timed out — save partial content and auto-retry
              if (accumulated.trim()) {
                const partialMessage: Message = {
                  id: 'temp-assistant-' + Date.now(),
                  session_id: sessionId,
                  role: 'assistant',
                  content: accumulated.trim() + `\n\n*(${t('chat.toolTimeout').replace('{name}', timeoutInfo.toolName).replace('{n}', String(timeoutInfo.elapsedSeconds))})*`,
                  created_at: new Date().toISOString(),
                  token_usage: null,
                };
                setMessages((prev) => [...prev, partialMessage]);
              }
              // Clean up before auto-retry
              toolTimeoutRef.current = null;
              setIsStreaming(false);
              setStreamingSessionId('');
              setStreamingContent('');
              accumulatedRef.current = '';
              toolUsesRef.current = [];
              toolResultsRef.current = [];
              setToolUses([]);
              setToolResults([]);
              setStreamingToolOutput('');
              setStatusText(undefined);
              setPendingPermission(null);
              setPermissionResolved(null);
              setPendingApprovalSessionId('');
              abortControllerRef.current = null;
              // Auto-retry: send a follow-up message telling the model to adjust strategy
              setTimeout(() => {
                sendMessageRef.current?.(
                  `The previous tool "${timeoutInfo.toolName}" timed out after ${timeoutInfo.elapsedSeconds} seconds. Please try a different approach to accomplish the task. Avoid repeating the same operation that got stuck.`
                );
              }, 500);
              return; // Skip the normal finally cleanup since we did it above
            }
            // User manually stopped generation — add partial content
            if (accumulated.trim()) {
              const partialMessage: Message = {
                id: 'temp-assistant-' + Date.now(),
                session_id: sessionId,
                role: 'assistant',
                content: accumulated.trim() + `\n\n*(${t('chat.generationStopped')})*`,
                created_at: new Date().toISOString(),
                token_usage: null,
              };
              setMessages((prev) => [...prev, partialMessage]);
            }
          }
        } else {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          const errorMessage: Message = {
            id: 'temp-error-' + Date.now(),
            session_id: sessionId,
            role: 'assistant',
            content: `**Error:** ${errMsg}`,
            created_at: new Date().toISOString(),
            token_usage: null,
          };
          setMessages((prev) => [...prev, errorMessage]);
        }
      } finally {
        clearInterval(idleCheckTimer);
        toolTimeoutRef.current = null;
        setIsStreaming(false);
        setStreamingSessionId('');
        setStreamingContent('');
        accumulatedRef.current = '';
        toolUsesRef.current = [];
        toolResultsRef.current = [];
        setToolUses([]);
        setToolResults([]);
        setStreamingToolOutput('');
        setStatusText(undefined);
        setPendingPermission(null);
        setPermissionResolved(null);
        setPendingApprovalSessionId('');
        abortControllerRef.current = null;
        // Notify file tree to refresh after AI finishes
        window.dispatchEvent(new CustomEvent('refresh-file-tree'));
        window.dispatchEvent(new CustomEvent('team-plan-refresh', { detail: { sessionId } }));
        if (shouldScheduleIdleTrigger) {
          scheduleIdleMemoryTrigger();
        }
      }
    },
    [
      clearIdleMemoryTimer,
      handleModeChange,
      sessionId,
      isStreaming,
      setStreamingSessionId,
      setContentPanelOpen,
      setPendingApprovalSessionId,
      mode,
      currentModel,
      currentProviderId,
      scheduleIdleMemoryTrigger,
      t,
    ]
  );

  // Keep sendMessageRef in sync so timeout auto-retry can call it
  sendMessageRef.current = sendMessage;

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
        setMessages(prev => [...prev, helpMessage]);
        break;
      }
      case '/clear':
        setMessages([]);
        // Also clear database messages and reset SDK session
        if (sessionId) {
          fetch(`/api/chat/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clear_messages: true }),
          }).catch(() => { /* silent */ });
        }
        break;
      case '/cost': {
        // Aggregate token usage from all messages in this session
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
        setMessages(prev => [...prev, costMessage]);
        break;
      }
      default:
        // This shouldn't be reached since non-immediate commands are handled via badge
        sendMessage(command);
    }
  }, [messages, sessionId, sendMessage, t]);

  // Listen for image generation completion — persist notice to DB and queue for next user message.
  // The notice is NOT sent as a separate LLM turn (avoids permission popups).
  // Instead it's flushed into the next user message via pendingImageNoticesRef.
  // MessageItem hides messages matching this prefix so the user doesn't see them.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const paths = (detail.images || [])
        .map((img: { localPath?: string }) => img.localPath)
        .filter(Boolean);
      const pathInfo = paths.length > 0 ? `\nGenerated image file paths:\n${paths.map((p: string) => `- ${p}`).join('\n')}` : '';
      const notice = `[Image generation completed]\n- Prompt: "${detail.prompt}"\n- Aspect ratio: ${detail.aspectRatio}\n- Resolution: ${detail.resolution}${pathInfo}`;

      // Store generated image paths so subsequent edits can use them as reference
      if (paths.length > 0) {
        setLastGeneratedImages(paths);
      }

      // Queue for next user message so the LLM gets the context
      pendingImageNoticesRef.current.push(notice);

      // Also persist to DB for history reload
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
      <div className={compactInputOnly ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        {!compactInputOnly ? (
          <>
          <MessageList
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            toolUses={toolUses}
            toolResults={toolResults}
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
          {/* Batch image generation panels — shown above the input area */}
          <BatchExecutionDashboard />
          <BatchContextSync />
          </>
        ) : null}
      </div>

      <MessageInput
        onSend={sendMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={false}
        isStreaming={isStreaming}
        sessionId={sessionId}
        modelName={currentModel}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        onProviderModelChange={handleProviderModelChange}
        workingDirectory={effectiveWorkingDirectory}
        mode={mode}
        onModeChange={handleModeChange}
        onInputFocus={onInputFocus}
        fullWidth={fullWidth}
      />
    </div>
  );
}
