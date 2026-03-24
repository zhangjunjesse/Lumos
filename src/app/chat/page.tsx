'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type {
  ChatKnowledgeOptions,
  Message,
  SessionResponse,
  PermissionRequestEvent,
  FileAttachment,
} from '@/types';
import { MessageList } from '@/components/chat/MessageList';
import { MessageInput } from '@/components/chat/MessageInput';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { MemoryConflictDialog } from '@/components/memory/memory-conflict-dialog';
import { MemoryOnboarding } from '@/components/memory/memory-onboarding';
import { getSessionEntryBasePath, getSessionEntryFromPath } from '@/lib/chat/session-entry';
import { stashPendingChatBootstrap } from '@/lib/chat/session-bootstrap';
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

interface ConflictData {
  conflictingMemory: {
    id: string;
    scope: string;
    category: string;
    content: string;
  };
  newContent: string;
}

export default function NewChatPage() {
  const pathname = usePathname();
  const router = useRouter();
  const { setWorkingDirectory, setPendingApprovalSessionId } = usePanel();
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([]);
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([]);
  const [statusText, setStatusText] = useState<string | undefined>();
  const [workingDir, setWorkingDir] = useState('');
  const [currentModel, setCurrentModel] = useState<string>(BUILTIN_CLAUDE_MODEL_IDS.sonnet);
  const [currentProviderId, setCurrentProviderId] = useState('');
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(null);
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | null>(null);
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [conflictData, setConflictData] = useState<ConflictData | null>(null);
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
    async (
      content: string,
      files?: FileAttachment[],
      systemPromptAppend?: string,
      _displayOverride?: string,
      knowledgeOptions?: ChatKnowledgeOptions,
    ) => {
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
          mode: 'code',
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

        // Notify any session list listeners to refresh immediately
        window.dispatchEvent(new CustomEvent('session-created'));
        stashPendingChatBootstrap({
          sessionId: session.id,
          content,
          ...(files && files.length > 0 ? { files } : {}),
          ...(systemPromptAppend ? { systemPromptAppend } : {}),
          ...(knowledgeOptions ? { knowledgeOptions } : {}),
        });

        router.push(`${sessionBasePath}/${session.id}`);
        return;
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
    [isMainAgentEntry, isStreaming, router, sessionBasePath, sessionEntry, setPendingApprovalSessionId, t, workingDir]
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
  }, [sendFirstMessage, t]);

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
