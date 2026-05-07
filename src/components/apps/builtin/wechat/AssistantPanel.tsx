'use client';

import * as React from 'react';
import { Loader2, Sparkles, Trash2 } from 'lucide-react';
import { StickToBottom } from 'use-stick-to-bottom';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import type { AppTab } from './wechat-types';

interface AssistantAction {
  type: string;
  label: string;
  query?: string;
  followupId?: string;
}

interface AssistantMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  actions?: AssistantAction[];
}

interface AssistantPanelProps {
  onUpdated: () => Promise<void> | void;
  onNavigate?: (tab: AppTab) => void;
  onOpenOverviewSearch?: (query: string) => void;
  onOpenFollowup?: (id?: string) => void;
  compactInputOnly?: boolean;
  embedded?: boolean;
  fullWidth?: boolean;
  hideEmptyState?: boolean;
  onInputFocus?: () => void;
}

const ASSISTANT_HISTORY_STORAGE_KEY = 'lumos.wechatAssistant.agentHistory.v1';
const MAX_HISTORY_MESSAGES = 40;

const WELCOME_MESSAGE: AssistantMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '我可以帮你搜索本机微信消息，管理微信提醒和每日总结，也可以新增、查看、完成跟进任务。比如：查一下微信里关于合同的消息；新增跟进：整理客户问题清单；每天晚上 9 点总结微信消息。',
};

export function AssistantPanel({
  onUpdated,
  onNavigate,
  onOpenOverviewSearch,
  onOpenFollowup,
  compactInputOnly = false,
  embedded = false,
  fullWidth = false,
  hideEmptyState = false,
  onInputFocus,
}: AssistantPanelProps): React.ReactElement {
  const [messages, setMessages] = React.useState<AssistantMessage[]>(() => loadHistory());
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionBusyKey, setActionBusyKey] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    persistHistory(messages);
  }, [messages]);

  const send = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busy) return;
    setDraft('');
    setActionError(null);
    setMessages((prev) => [...prev, makeMessage('user', text)]);
    setBusy(true);
    let shouldRefresh = false;
    try {
      const res = await fetch('/api/apps/builtin/wechat/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        reply?: unknown;
        error?: string;
        message?: string;
        actions?: unknown;
      };
      if (!res.ok) throw new Error(json.message ?? json.error ?? '微信助手暂时不可用');
      const reply = typeof json.reply === 'string' && json.reply.trim() ? json.reply : '已处理。';
      const actions = Array.isArray(json.actions) ? json.actions.filter(isAssistantAction) : undefined;
      setMessages((prev) => [...prev, makeMessage('assistant', reply, actions)]);
      shouldRefresh = true;
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        makeMessage('assistant', err instanceof Error ? err.message : '微信助手暂时不可用'),
      ]);
    } finally {
      if (!shouldRefresh) setBusy(false);
    }

    if (shouldRefresh) {
      try {
        await onUpdated();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : '操作已完成，但刷新页面状态失败。请手动刷新。');
      } finally {
        setBusy(false);
      }
    }
  };

  const handleAction = React.useCallback(async (action: AssistantAction, key: string) => {
    if (actionBusyKey) return;
    setActionError(null);

    if (action.type === 'open_overview') {
      if (action.query) onOpenOverviewSearch?.(action.query);
      onNavigate?.('overview');
      return;
    }
    if (action.type === 'open_followups') {
      if (onOpenFollowup) {
        onOpenFollowup(action.followupId);
      } else {
        onNavigate?.('followups');
      }
      setActionBusyKey(key);
      try {
        await onUpdated();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : '跟进页已打开，但刷新列表失败。请手动刷新。');
      } finally {
        setActionBusyKey(null);
      }
      return;
    }

    setActionBusyKey(key);
    try {
      await onUpdated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '操作失败，请稍后重试。');
    } finally {
      setActionBusyKey(null);
    }
  }, [actionBusyKey, onNavigate, onOpenFollowup, onOpenOverviewSearch, onUpdated]);

  const clearHistory = React.useCallback(() => {
    setMessages([WELCOME_MESSAGE]);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(ASSISTANT_HISTORY_STORAGE_KEY);
    } catch {
      // Keep the UI usable even if localStorage is blocked.
    }
  }, []);

  const inputArea = (
    <div className="bg-background/80 px-4 py-3 backdrop-blur-lg">
      <div className={fullWidth ? 'mx-auto w-full' : 'mx-auto w-full max-w-3xl'}>
        <PromptInput
          onSubmit={(message) => send(message.text)}
          className="w-full"
        >
          <PromptInputTextarea
            disabled={busy}
            placeholder="例如：每天晚上 9 点总结微信消息"
            className={compactInputOnly ? 'min-h-10' : 'min-h-12'}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onFocus={onInputFocus}
          />
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit
              status={busy ? 'streaming' : 'ready'}
              disabled={busy || !draft.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );

  if (compactInputOnly) {
    return (
      <div className={fullWidth ? 'w-full' : undefined}>
        {inputArea}
      </div>
    );
  }

  const body = (
    <div className={embedded ? 'flex h-full min-h-0 flex-col gap-3 px-3 pb-0 pt-2' : 'flex flex-col gap-3 p-5'}>
        <div className="flex items-center justify-between gap-2">
          {!hideEmptyState ? (
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Sparkles className="size-3.5" />
              微信助手
            </div>
          ) : <span />}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={clearHistory}
            aria-label="清空历史"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <StickToBottom
          className={embedded
            ? 'relative flex min-h-0 flex-1 flex-col overflow-y-hidden rounded-lg border bg-muted/20'
            : 'relative flex max-h-56 min-h-56 flex-col overflow-y-hidden rounded-lg border bg-muted/20'}
          initial="smooth"
          resize="instant"
          role="log"
        >
          <StickToBottom.Content className="flex min-h-full flex-col gap-2 p-3">
            {messages.map((message, idx) => (
              <div
                key={message.id || idx}
                className={message.role === 'user'
                  ? 'ml-auto max-w-[85%] rounded-lg bg-foreground px-3 py-2 text-xs leading-5 text-background'
                  : 'mr-auto max-w-[85%] rounded-lg bg-background px-3 py-2 text-xs leading-5 text-foreground shadow-sm'}
              >
                <div className="whitespace-pre-wrap break-words">{message.content}</div>
                {message.role === 'assistant' && message.actions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {message.actions.map((action, actionIndex) => {
                      const key = `${message.id}-${action.type}-${actionIndex}`;
                      const actionBusy = actionBusyKey === key;
                      return (
                        <Button
                          key={`${action.type}-${actionIndex}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          disabled={busy || Boolean(actionBusyKey)}
                          onClick={() => void handleAction(action, key)}
                        >
                          {actionBusy ? <Loader2 className="size-3 animate-spin" /> : null}
                          {action.label}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </StickToBottom.Content>
        </StickToBottom>
        {actionError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {actionError}
          </div>
        ) : null}
        {inputArea}
    </div>
  );

  if (embedded) return body;

  return (
    <Card className="border-foreground/20">
      <CardContent className="p-0">
        {body}
      </CardContent>
    </Card>
  );
}

function loadHistory(): AssistantMessage[] {
  if (typeof window === 'undefined') return [WELCOME_MESSAGE];
  try {
    const raw = window.localStorage.getItem(ASSISTANT_HISTORY_STORAGE_KEY);
    if (!raw) return [WELCOME_MESSAGE];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [WELCOME_MESSAGE];
    const messages = parsed.filter(isAssistantMessage).slice(-MAX_HISTORY_MESSAGES);
    return messages.length > 0 ? messages : [WELCOME_MESSAGE];
  } catch {
    return [WELCOME_MESSAGE];
  }
}

function persistHistory(messages: AssistantMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    const next = messages.slice(-MAX_HISTORY_MESSAGES);
    window.localStorage.setItem(ASSISTANT_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Losing persisted history is acceptable if storage is unavailable.
  }
}

function makeMessage(
  role: AssistantMessage['role'],
  content: string,
  actions?: AssistantAction[],
): AssistantMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    actions: actions?.filter(isAssistantAction),
  };
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AssistantMessage>;
  return (
    typeof item.id === 'string'
    && (item.role === 'assistant' || item.role === 'user')
    && typeof item.content === 'string'
    && (item.actions === undefined || (Array.isArray(item.actions) && item.actions.every(isAssistantAction)))
  );
}

function isAssistantAction(value: unknown): value is AssistantAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<AssistantAction>;
  return (
    typeof action.type === 'string'
    && typeof action.label === 'string'
    && (action.query === undefined || typeof action.query === 'string')
    && (action.followupId === undefined || typeof action.followupId === 'string')
  );
}
