'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ChatView } from '@/components/chat/ChatView';
import { useMessagesStore } from '@/stores/messages-store';
import { useStreamingStore } from '@/stores/streaming-store';
import { parseMessageContent } from '@/types';

const CAPABILITY_SESSION_ID = 'capability-authoring';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface GeneratedCapabilityState {
  draft: {
    id: string;
    name: string;
    description: string;
    kind?: 'code' | 'prompt';
    category: string;
    riskLevel: 'low' | 'medium' | 'high';
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  };
  explanation: string;
}

function flattenMessageContent(raw: string): string {
  const blocks = parseMessageContent(raw);
  const texts = blocks.flatMap((block) => {
    if (block.type === 'text') {
      return [block.text];
    }
    if (block.type === 'code') {
      return [block.code];
    }
    if (block.type === 'reasoning') {
      return [block.summary];
    }
    return [];
  });

  return texts.join('\n\n').trim();
}

export default function NewCapabilityPage() {
  const router = useRouter();
  const cachedMessagesSession = useMessagesStore((state) => state.sessions[CAPABILITY_SESSION_ID] ?? null);
  const streamingSession = useStreamingStore((state) => state.sessions[CAPABILITY_SESSION_ID] ?? null);
  const [generatedCapability, setGeneratedCapability] = useState<GeneratedCapabilityState | null>(null);
  const [generatedFromKey, setGeneratedFromKey] = useState('');
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversationHistory = useMemo<ConversationMessage[]>(() => {
    const messages = cachedMessagesSession?.messages || [];

    return messages
      .map((message) => ({
        role: message.role,
        content: flattenMessageContent(message.content),
      }))
      .filter((message) => message.content.length > 0);
  }, [cachedMessagesSession?.messages]);

  const conversationKey = useMemo(
    () => (cachedMessagesSession?.messages || []).map((message) => message.id).join('|'),
    [cachedMessagesSession?.messages]
  );
  const isStreaming = streamingSession?.status === 'streaming';
  const hasConversation = conversationHistory.some((message) => message.role === 'user');
  const needsRegenerate = Boolean(generatedCapability && generatedFromKey && generatedFromKey !== conversationKey);

  async function handleGenerateCapability() {
    if (!hasConversation || isStreaming || generating) {
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/capabilities/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationHistory,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '生成能力失败');
      }

      setGeneratedCapability(data);
      setGeneratedFromKey(conversationKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成能力失败');
    } finally {
      setGenerating(false);
    }
  }

  async function handlePublishCapability() {
    if (!generatedCapability || publishing || needsRegenerate) {
      return;
    }

    setPublishing(true);
    setError(null);

    try {
      const response = await fetch('/api/capabilities/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          draftId: generatedCapability.draft.id,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '发布能力失败');
      }

      router.push(`/capabilities/${generatedCapability.draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布能力失败');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">新增能力</h1>
            <p className="text-sm text-muted-foreground mt-1">
              先和 AI 把需求聊清楚，再生成并发布能力
            </p>
          </div>
        </div>
      </div>

      <div className="border-b px-6 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleGenerateCapability}
            disabled={!hasConversation || isStreaming || generating}
          >
            {generating ? '生成中...' : '生成待发布能力'}
          </Button>
          <Button
            variant="secondary"
            onClick={handlePublishCapability}
            disabled={!generatedCapability || publishing || needsRegenerate}
          >
            {publishing ? '发布中...' : '发布能力'}
          </Button>
          <span className="text-sm text-muted-foreground">
            {isStreaming
              ? 'AI 还在对话中，等它回答完再生成。'
              : generatedCapability
                ? needsRegenerate
                  ? '对话已更新，请重新生成后再发布。'
                  : '能力已生成，可以直接发布。'
                : '先完成几轮对话，再生成能力摘要。'}
          </span>
        </div>

        {generatedCapability ? (
          <Card className="p-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{generatedCapability.draft.name}</h3>
                <span className="text-xs text-muted-foreground">
                  {generatedCapability.draft.kind === 'prompt' ? 'Prompt 节点' : '代码节点'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {generatedCapability.draft.riskLevel}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {generatedCapability.explanation}
              </p>
              <div className="text-xs text-muted-foreground">
                <span>能力 ID：{generatedCapability.draft.id}</span>
                <span className="ml-4">分类：{generatedCapability.draft.category}</span>
              </div>
            </div>
          </Card>
        ) : null}

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : null}
      </div>

      <div className="flex-1 overflow-hidden">
        <ChatView
          sessionId={CAPABILITY_SESSION_ID}
          hideEmptyState={false}
          fullWidth={true}
        />
      </div>
    </div>
  );
}
