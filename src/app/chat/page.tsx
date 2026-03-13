'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Message, SSEEvent, SessionResponse, TokenUsage, PermissionRequestEvent, FileAttachment } from '@/types';
import { MessageList } from '@/components/chat/MessageList';
import { MessageInput } from '@/components/chat/MessageInput';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { useMemoryToast } from '@/components/memory/memory-toast-container';
import { MemoryConflictDialog } from '@/components/memory/memory-conflict-dialog';
import { MemoryOnboarding } from '@/components/memory/memory-onboarding';
import { getSessionEntryBasePath, getSessionEntryFromPath } from '@/lib/chat/session-entry';
import { BUILTIN_CLAUDE_MODEL_IDS } from '@/lib/model-metadata';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
}

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

export default function NewChatPage() {
  const pathname = usePathname();
  const router = useRouter();
  const { setWorkingDirectory, setPanelOpen, setPendingApprovalSessionId } = usePanel();
  const { t } = useTranslation();
  const { showToast } = useMemoryToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([]);
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([]);
  const [statusText, setStatusText] = useState<string | undefined>();
  const [workingDir, setWorkingDir] = useState('');
  const [mode, setMode] = useState('code');
  const [currentModel, setCurrentModel] = useState<string>(BUILTIN_CLAUDE_MODEL_IDS.sonnet);
  const [currentProviderId, setCurrentProviderId] = useState('');
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(null);
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | null>(null);
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [conflictData, setConflictData] = useState<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionEntry = getSessionEntryFromPath(pathname);
  const sessionBasePath = getSessionEntryBasePath(sessionEntry);
  const isMainAgentEntry = sessionEntry === 'main-agent';

  // Chat entry inherits workspace context; Main Agent stays neutral until user picks one.
  useEffect(() => {
    if (isMainAgentEntry) {
      setWorkingDir('');
      setWorkingDirectory('');
      return;
    }

    const saved = localStorage.getItem('codepilot:last-working-directory');
    if (saved) {
      setWorkingDir(saved);
      setWorkingDirectory(saved);
      return;
    }
    fetch('/api/workspaces')
      .then(r => r.json())
      .then(data => {
        const active = (data.workspaces || []).find((w: { is_active: number }) => w.is_active);
        if (active?.path) {
          setWorkingDir(active.path);
          setWorkingDirectory(active.path);
          localStorage.setItem('codepilot:last-working-directory', active.path);
        }
      })
      .catch(() => {});
  }, [isMainAgentEntry, setWorkingDirectory]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handlePermissionResponse = useCallback(async (decision: 'allow' | 'allow_session' | 'deny') => {
    if (!pendingPermission) return;

    const body: { permissionRequestId: string; decision: { behavior: 'allow'; updatedPermissions?: unknown[] } | { behavior: 'deny'; message?: string } } = {
      permissionRequestId: pendingPermission.permissionRequestId,
      decision: decision === 'deny'
        ? { behavior: 'deny', message: 'User denied permission' }
        : {
            behavior: 'allow',
            ...(decision === 'allow_session' && pendingPermission.suggestions
              ? { updatedPermissions: pendingPermission.suggestions }
              : {}),
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
      // Best effort
    }

    setTimeout(() => {
      setPendingPermission(null);
      setPermissionResolved(null);
    }, 1000);
  }, [pendingPermission, setPendingApprovalSessionId]);

  const sendFirstMessage = useCallback(
    async (content: string, files?: FileAttachment[], systemPromptAppend?: string) => {
      if (isStreaming) return;

      // Legacy /chat sessions remain project-scoped. Main Agent can start globally.
      if (!isMainAgentEntry && !workingDir.trim()) {
        const hint: Message = {
          id: 'hint-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: t('chat.selectProjectDir'),
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages((prev) => [...prev, hint]);
        return;
      }

      setIsStreaming(true);
      setStreamingContent('');
      setToolUses([]);
      setToolResults([]);
      setStatusText(undefined);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let sessionId = '';

      try {
        const createBody: Record<string, string> = {
          title: content.slice(0, 50),
          mode,
          entry: sessionEntry,
        };
        if (workingDir.trim()) {
          createBody.working_directory = workingDir.trim();
        }

        const createRes = await fetch('/api/chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });

        if (!createRes.ok) {
          const errBody = await createRes.json().catch(() => ({}));
          throw new Error(errBody.error || `Failed to create session (${createRes.status})`);
        }

        const { session }: SessionResponse = await createRes.json();
        sessionId = session.id;

        // Notify ChatListPanel to refresh immediately
        window.dispatchEvent(new CustomEvent('session-created'));

        // Add user message to UI (embed file metadata like ChatView)
        let displayContent = content;
        if (files && files.length > 0) {
          const fileMeta = files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data }));
          displayContent = `<!--files:${JSON.stringify(fileMeta)}-->${content}`;
        }
        const userMessage: Message = {
          id: 'temp-' + Date.now(),
          session_id: session.id,
          role: 'user',
          content: displayContent,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages([userMessage]);

        // Send the message via streaming API
        const bridgeHeaders = await getBrowserBridgeHeaders();
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...bridgeHeaders,
          },
          body: JSON.stringify({ session_id: session.id, content, mode, model: currentModel, provider_id: currentProviderId, ...(systemPromptAppend ? { systemPromptAppend } : {}), ...(files && files.length > 0 ? { files } : {}) }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to send message');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let accumulated = '';
        let tokenUsage: TokenUsage | null = null;
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            try {
              const event: SSEEvent = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'text': {
                  accumulated += event.data;
                  setStreamingContent(accumulated);
                  break;
                }
                case 'tool_use': {
                  try {
                    const toolData = JSON.parse(event.data);
                    setStreamingToolOutput('');
                    setToolUses((prev) => {
                      if (prev.some((t) => t.id === toolData.id)) return prev;
                      return [...prev, { id: toolData.id, name: toolData.name, input: toolData.input }];
                    });
                  } catch { /* skip */ }
                  break;
                }
                case 'tool_result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    setStreamingToolOutput('');
                    setToolResults((prev) => [...prev, { tool_use_id: resultData.tool_use_id, content: resultData.content }]);
                  } catch { /* skip */ }
                  break;
                }
                case 'tool_output': {
                  try {
                    const parsed = JSON.parse(event.data);
                    if (parsed._progress) {
                      setStatusText(`Running ${parsed.tool_name}... (${Math.round(parsed.elapsed_time_seconds)}s)`);
                      break;
                    }
                  } catch {
                    // Not JSON — raw stderr output
                  }
                  setStreamingToolOutput((prev) => {
                    const next = prev + (prev ? '\n' : '') + event.data;
                    return next.length > 5000 ? next.slice(-5000) : next;
                  });
                  break;
                }
                case 'status': {
                  try {
                    const statusData = JSON.parse(event.data);
                    if (statusData.session_id) {
                      setStatusText(`Connected (${statusData.model || 'claude'})`);
                      setTimeout(() => setStatusText(undefined), 2000);
                    } else if (statusData.notification) {
                      setStatusText(statusData.message || statusData.title || undefined);
                    } else {
                      setStatusText(event.data || undefined);
                    }
                  } catch {
                    setStatusText(event.data || undefined);
                  }
                  break;
                }
                case 'result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    if (resultData.usage) tokenUsage = resultData.usage;
                  } catch { /* skip */ }
                  setStatusText(undefined);
                  break;
                }
                case 'permission_request': {
                  try {
                    const permData: PermissionRequestEvent = JSON.parse(event.data);
                    setPendingPermission(permData);
                    setPermissionResolved(null);
                    setPendingApprovalSessionId(sessionId);
                  } catch {
                    // skip malformed permission_request data
                  }
                  break;
                }
                case 'error': {
                  accumulated += '\n\n**Error:** ' + event.data;
                  setStreamingContent(accumulated);
                  break;
                }
                case 'memory_captured': {
                  try {
                    const memoryData = JSON.parse(event.data);
                    showToast(memoryData, memoryData.action || 'created');
                  } catch { /* skip */ }
                  break;
                }
                case 'memory_conflict': {
                  try {
                    const conflictInfo = JSON.parse(event.data);
                    setConflictData(conflictInfo);
                  } catch { /* skip */ }
                  break;
                }
                case 'done':
                  break;
              }
            } catch {
              // skip
            }
          }
        }

        // Add the completed assistant message
        if (accumulated.trim()) {
          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: session.id,
            role: 'assistant',
            content: accumulated.trim(),
            created_at: new Date().toISOString(),
            token_usage: tokenUsage ? JSON.stringify(tokenUsage) : null,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }

        // Navigate to the session page after response is complete
        router.push(`${sessionBasePath}/${session.id}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // User stopped - navigate to session if we have one
          if (sessionId) {
            router.push(`${sessionBasePath}/${sessionId}`);
          }
        } else {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          const errorMessage: Message = {
            id: 'temp-error-' + Date.now(),
            session_id: '',
            role: 'assistant',
            content: `**Error:** ${errMsg}`,
            created_at: new Date().toISOString(),
            token_usage: null,
          };
          setMessages((prev) => [...prev, errorMessage]);
        }
      } finally {
        setIsStreaming(false);
        setStreamingContent('');
        setToolUses([]);
        setToolResults([]);
        setStreamingToolOutput('');
        setStatusText(undefined);
        setPendingPermission(null);
        setPermissionResolved(null);
        setPendingApprovalSessionId('');
        abortControllerRef.current = null;
      }
    },
    [currentModel, currentProviderId, isMainAgentEntry, isStreaming, mode, router, sessionBasePath, sessionEntry, setPendingApprovalSessionId, workingDir]
  );

  const handleConflictResolve = useCallback(async (action: 'replace' | 'keep_both' | 'cancel') => {
    if (!conflictData) return;

    if (action === 'cancel') {
      setConflictData(null);
      return;
    }

    try {
      await fetch('/api/memory/resolve-conflict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conflictingMemoryId: conflictData.conflictingMemory.id,
          newContent: conflictData.newContent,
          action,
          sessionId: '',
          projectPath: workingDir,
          scope: conflictData.conflictingMemory.scope,
          category: conflictData.conflictingMemory.category,
        }),
      });
      setConflictData(null);
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
    }
  }, [conflictData, workingDir]);

  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case '/help': {
        const helpMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## ${t('chat.helpTitle')}\n\n- **/help** - ${t('messageInput.helpDesc')}\n- **/clear** - ${t('messageInput.clearDesc')}\n- **/compact** - ${t('messageInput.compactDesc')}\n- **/cost** - ${t('messageInput.costDesc')}\n- **/doctor** - ${t('messageInput.doctorDesc')}\n- **/init** - ${t('messageInput.initDesc')}\n- **/review** - ${t('messageInput.reviewDesc')}\n- **/terminal-setup** - ${t('messageInput.terminalSetupDesc')}\n\n**${t('chat.helpTips')}:**\n- ${t('chat.helpTipMention')}\n- ${t('chat.helpTipNewline')}\n- ${t('chat.helpTipFolder')}`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, helpMessage]);
        break;
      }
      case '/clear':
        setMessages([]);
        break;
      case '/cost': {
        const costMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## ${t('chat.tokenUsageTitle')}\n\n${t('chat.tokenUsageHint')}`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, costMessage]);
        break;
      }
      default:
        sendFirstMessage(command);
    }
  }, [sendFirstMessage]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="h-8 w-full shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
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
      />
      <MessageInput
        onSend={sendFirstMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={false}
        isStreaming={isStreaming}
        modelName={currentModel}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        onProviderModelChange={(pid, model) => {
          setCurrentProviderId(pid);
          setCurrentModel(model);
        }}
        workingDirectory={workingDir}
        mode={mode}
        onModeChange={setMode}
      />
      <MemoryConflictDialog
        isOpen={!!conflictData}
        conflictData={conflictData}
        onResolve={handleConflictResolve}
      />
      <MemoryOnboarding />
    </div>
  );
}
