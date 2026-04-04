'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading } from '@hugeicons/core-free-icons';
import { ChatView } from '@/components/chat/ChatView';
import { useMessagesStore } from '@/stores/messages-store';
import type { ChatSession, Message, MessagesResponse } from '@/types';

const WORKFLOW_CHAT_MARKER = '__LUMOS_WORKFLOW_CHAT__';
const STORAGE_KEY_PREFIX = 'lumos:workflow-chat-session:';

const CAPABILITIES_SENTINEL = '## 能力说明';

function isWorkflowChatSession(
  session?: Pick<ChatSession, 'system_prompt'> | null,
): boolean {
  return Boolean(session?.system_prompt?.includes(WORKFLOW_CHAT_MARKER));
}

function needsCapabilitiesUpgrade(
  session?: Pick<ChatSession, 'system_prompt'> | null,
): boolean {
  return isWorkflowChatSession(session) && !session?.system_prompt?.includes(CAPABILITIES_SENTINEL);
}

/** Extract valid workflow DSL JSON from a message text. */
function extractDslFromText(text: string): Record<string, unknown> | null {
  // Try code blocks first (```json ... ``` or ``` ... ```)
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const parsed = tryParseDsl(match[1].trim());
    if (parsed) return parsed;
  }
  // Fallback: find first { ... } that looks like DSL
  const braceStart = text.indexOf('{');
  if (braceStart === -1) return null;
  const braceEnd = text.lastIndexOf('}');
  if (braceEnd <= braceStart) return null;
  return tryParseDsl(text.slice(braceStart, braceEnd + 1));
}

function tryParseDsl(json: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(json);
    if (obj && typeof obj === 'object' && 'steps' in obj && Array.isArray(obj.steps)) {
      return obj as Record<string, unknown>;
    }
  } catch { /* not valid JSON */ }
  return null;
}

/** Get text content from the last assistant message. */
function getLastAssistantText(msgs: Message[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== 'assistant') continue;
    const raw = msgs[i].content;
    // content is a JSON string of MessageContentBlock[]
    try {
      const blocks = JSON.parse(raw) as Array<{ type: string; text?: string }>;
      if (Array.isArray(blocks)) {
        return blocks
          .filter(b => b.type === 'text' && b.text)
          .map(b => b.text!)
          .join('\n');
      }
    } catch { /* plain text fallback */ }
    return raw;
  }
  return '';
}

type WorkflowChatPanelProps = {
  /** Workflow ID — each workflow gets its own chat session */
  workflowId: string;
  /** Current DSL, injected into new session system prompt */
  currentDsl?: Record<string, unknown>;
  /** Called when user clicks "apply" on a DSL detected in chat */
  onApplyDsl?: (dsl: Record<string, unknown>) => void;
  compactInputOnly?: boolean;
  onInputFocus?: () => void;
  fullWidth?: boolean;
  hideEmptyState?: boolean;
};

export function WorkflowChatPanel({
  workflowId,
  currentDsl,
  onApplyDsl,
  compactInputOnly = false,
  onInputFocus,
  fullWidth = false,
  hideEmptyState = false,
}: WorkflowChatPanelProps) {
  const [sessionId, setSessionId] = useState('');
  const [sessionModel, setSessionModel] = useState('');
  const [sessionProviderId, setSessionProviderId] = useState('');
  const [sessionWorkingDirectory, setSessionWorkingDirectory] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const storageKey = STORAGE_KEY_PREFIX + workflowId;
  // Use ref so init effect only runs once per workflow, not on every DSL edit
  const currentDslRef = useRef(currentDsl);
  currentDslRef.current = currentDsl;
  // Stable string for DSL change detection (avoids effect re-fire on same-content new refs)
  const dslJsonForSync = currentDsl ? JSON.stringify(currentDsl) : '';

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

      let nextSession: ChatSession | null = null;
      const cachedId = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;

      if (cachedId) {
        try {
          const res = await fetch(`/api/chat/sessions/${cachedId}`);
          if (res.ok) {
            const data: { session: ChatSession } = await res.json();
            if (isWorkflowChatSession(data.session)) {
              nextSession = data.session;
              // Upgrade old sessions that lack capabilities hint
              if (needsCapabilitiesUpgrade(nextSession)) {
                const refreshRes = await fetch('/api/workflow/chat/session/refresh', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId: cachedId, workflowDsl: currentDslRef.current }),
                });
                if (refreshRes.ok) {
                  const refreshData: { session: ChatSession } = await refreshRes.json();
                  nextSession = refreshData.session;
                }
              }
            } else if (typeof window !== 'undefined') {
              localStorage.removeItem(storageKey);
            }
          } else {
            // Only clear cache on 404 (session deleted), not on transient errors
            if (res.status === 404 && typeof window !== 'undefined') {
              localStorage.removeItem(storageKey);
            }
          }
        } catch {
          // Network error — don't clear cache, just fall through to create
        }
      }

      if (!nextSession) {
        try {
          const res = await fetch('/api/workflow/chat/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflowDsl: currentDslRef.current }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error || '初始化工作流会话失败');
          }
          const data: { session: ChatSession } = await res.json();
          nextSession = data.session;
          if (typeof window !== 'undefined') {
            localStorage.setItem(storageKey, data.session.id);
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : '初始化工作流会话失败');
            setLoading(false);
          }
          return;
        }
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
    return () => { cancelled = true; };
  }, [loadMessages, storageKey]);

  useEffect(() => {
    if (!sessionId) return;
    const interval = window.setInterval(() => { void loadMessages(sessionId); }, 4000);
    return () => window.clearInterval(interval);
  }, [loadMessages, sessionId]);

  // Sync DSL changes to agent session prompt (debounced 1.5s)
  const dslSyncSkipFirst = useRef(true);
  useEffect(() => {
    if (!sessionId || !dslJsonForSync) return;
    // Skip first run — init already embedded DSL into session
    if (dslSyncSkipFirst.current) {
      dslSyncSkipFirst.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void fetch('/api/workflow/chat/session/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, workflowDsl: currentDslRef.current }),
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [sessionId, dslJsonForSync]);

  // Read from ChatView's centralized store for real-time detection (no 4s polling lag)
  const storeMessages = useMessagesStore((state) => state.sessions[sessionId]?.messages);
  const messagesForDetection = storeMessages ?? messages;

  const detectedDsl = useMemo(() => {
    if (!onApplyDsl || messagesForDetection.length === 0) return null;
    const text = getLastAssistantText(messagesForDetection);
    return text ? extractDslFromText(text) : null;
  }, [onApplyDsl, messagesForDetection]);

  const [applied, setApplied] = useState(false);
  useEffect(() => { setApplied(false); }, [detectedDsl]);

  const handleApply = useCallback(() => {
    if (detectedDsl && onApplyDsl) {
      onApplyDsl(detectedDsl);
      setApplied(true);
    }
  }, [detectedDsl, onApplyDsl]);

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
        />
        {detectedDsl && !compactInputOnly && (
          <div className="absolute bottom-16 left-1/2 z-20 -translate-x-1/2">
            <button
              onClick={handleApply}
              disabled={applied}
              className={`rounded-full px-4 py-1.5 text-xs font-medium shadow-lg transition-all ${
                applied
                  ? 'bg-green-600 text-white cursor-default'
                  : 'bg-primary text-primary-foreground hover:opacity-90 active:scale-95'
              }`}
            >
              {applied ? '✓ 已应用' : '应用到编辑器'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
