'use client';

import * as React from 'react';
import { Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { AutomationTaskList } from './AutomationTaskList';
import type { AgentMessage, BuiltinTask } from './wechat-types';

const PROMPT_SUGGESTIONS = [
  '每天晚上 9 点总结微信消息',
  '只在工作日早上 9 点提醒待办',
  '暂停每日总结',
  '关注合同、付款、报价关键词',
];

export function AutomationTab({
  tasks,
  busyId,
  agent,
  onUpdate,
  onAgentInput,
  onAgentSend,
  onRunSummary,
  analysisLoading,
}: {
  tasks: BuiltinTask[];
  busyId: string | null;
  analysisLoading: boolean;
  agent: { messages: AgentMessage[]; input: string; busy: boolean };
  onUpdate: (task: BuiltinTask, patch: Partial<Pick<BuiltinTask, 'enabled' | 'schedule'>>) => void;
  onAgentInput: (value: string) => void;
  onAgentSend: () => void;
  onRunSummary: () => void;
}): React.ReactElement {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
      <AgentChat
        messages={agent.messages}
        input={agent.input}
        busy={agent.busy}
        onInput={onAgentInput}
        onSend={onAgentSend}
      />
      <AutomationTaskList
        tasks={tasks}
        busyId={busyId}
        analysisLoading={analysisLoading}
        onUpdate={onUpdate}
        onRunSummary={onRunSummary}
      />
    </div>
  );
}

function AgentChat({
  messages,
  input,
  busy,
  onInput,
  onSend,
}: {
  messages: AgentMessage[];
  input: string;
  busy: boolean;
  onInput: (value: string) => void;
  onSend: () => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  return (
    <Card className="flex min-h-[480px] flex-col overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold tracking-tight">对话调整</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        <div
          ref={scrollRef}
          className="flex max-h-[320px] flex-1 flex-col gap-3 overflow-y-auto rounded-2xl border bg-background/40 p-3"
        >
          {messages.map((message, index) => (
            <Bubble key={index} role={message.role} content={message.content} />
          ))}
          {busy ? (
            <div className="inline-flex items-center gap-2 self-start rounded-2xl bg-card px-3 py-2 text-xs text-muted-foreground ring-1 ring-border">
              <Loader2 className="size-3 animate-spin" />
              处理中...
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {PROMPT_SUGGESTIONS.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => onInput(sample)}
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {sample}
            </button>
          ))}
        </div>
        <div className="rounded-2xl border bg-background/60 p-2">
          <Textarea
            value={input}
            onChange={(event) => onInput(event.target.value)}
            placeholder="例如：每天 21:00 总结消息；暂停每日总结"
            rows={3}
            className="min-h-0 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                onSend();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-1">
            <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter 发送</span>
            <Button onClick={onSend} disabled={!input.trim() || busy} size="sm">
              <Send />
              发送
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Bubble({ role, content }: { role: AgentMessage['role']; content: string }) {
  const me = role === 'user';
  return (
    <div className={cn('flex w-full', me ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] break-words rounded-2xl px-3 py-2 text-sm leading-6',
          me
            ? 'rounded-br-sm bg-foreground text-background'
            : 'rounded-bl-sm bg-card text-foreground ring-1 ring-border',
        )}
      >
        {content}
      </div>
    </div>
  );
}
