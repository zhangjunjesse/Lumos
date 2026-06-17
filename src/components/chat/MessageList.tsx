'use client';

import { useRef, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { Message, PermissionRequestEvent } from '@/types';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { MessageItem } from './MessageItem';
import { StreamingMessage } from './StreamingMessage';
import { LumosLogo } from './LumosLogo';
import { MessageMemoryTag } from './message-memory-tag';

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

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  pinStreamingStart?: boolean;
  reasoningSummaries?: string[];
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingToolOutput?: string;
  statusText?: string;
  pendingPermission?: PermissionRequestEvent | null;
  onPermissionResponse?: (decision: 'allow' | 'allow_session' | 'deny') => void;
  permissionResolved?: 'allow' | 'deny' | null;
  onForceStop?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  fullWidth?: boolean;
  hideEmptyState?: boolean;
}

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  pinStreamingStart = false,
  reasoningSummaries = [],
  toolUses = [],
  toolResults = [],
  streamingToolOutput,
  statusText,
  pendingPermission,
  onPermissionResponse,
  permissionResolved,
  onForceStop,
  hasMore,
  loadingMore,
  onLoadMore,
  fullWidth = false,
  hideEmptyState = false,
}: MessageListProps) {
  const { t } = useTranslation();
  // Scroll anchor: preserve position when older messages are prepended
  const anchorIdRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef(messages.length);
  const latestUserMessageRef = useRef<HTMLDivElement | null>(null);
  const wasStreamingRef = useRef(isStreaming);

  // Before loading more, record the first visible message ID
  const handleLoadMore = () => {
    if (messages.length > 0) {
      anchorIdRef.current = messages[0].id;
    }
    onLoadMore?.();
  };

  // After messages are prepended, scroll the anchor element back into view
  useEffect(() => {
    if (anchorIdRef.current && messages.length > prevMessageCountRef.current) {
      const el = document.getElementById(`msg-${anchorIdRef.current}`);
      if (el) {
        el.scrollIntoView({ block: 'start' });
      }
      anchorIdRef.current = null;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (pinStreamingStart && isStreaming && !wasStreamingRef.current) {
      window.requestAnimationFrame(() => {
        latestUserMessageRef.current?.scrollIntoView({ block: 'start' });
      });
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, pinStreamingStart]);

  if (messages.length === 0 && !isStreaming) {
    if (hideEmptyState) {
      return <div className="flex-1" />;
    }
    return (
      <div className="flex flex-1 items-center justify-center">
        <ConversationEmptyState
          title={t('messageList.claudeChat')}
          description={t('messageList.emptyDescription')}
          icon={<LumosLogo className="h-16 w-16" />}
        />
      </div>
    );
  }

  let latestUserMessageId: string | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserMessageId = messages[index].id;
      break;
    }
  }

  return (
    <Conversation>
      <ConversationContent className={fullWidth ? "px-4 py-6 gap-6" : "mx-auto max-w-3xl px-4 py-6 gap-6"}>
        {hasMore && (
          <div className="flex justify-center">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {loadingMore ? t('messageList.loading') : t('messageList.loadEarlier')}
            </button>
          </div>
        )}
        {messages.map((message) => {
          const isLatestUserMessage = message.id === latestUserMessageId;
          return (
            <div
              key={message.id}
              id={`msg-${message.id}`}
              ref={isLatestUserMessage ? latestUserMessageRef : undefined}
            >
              <MessageItem message={message} />
              <MessageMemoryTag messageId={message.id} />
            </div>
          );
        })}

        {isStreaming && (
          <div>
            <StreamingMessage
              content={streamingContent}
              isStreaming={isStreaming}
              reasoningSummaries={reasoningSummaries}
              toolUses={toolUses}
              toolResults={toolResults}
              streamingToolOutput={streamingToolOutput}
              statusText={statusText}
              pendingPermission={pendingPermission}
              onPermissionResponse={onPermissionResponse}
              permissionResolved={permissionResolved}
              onForceStop={onForceStop}
            />
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
