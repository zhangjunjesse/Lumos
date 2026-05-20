"use client";

import { Fragment, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Message } from "@/types";
import { parseDBDate } from "@/lib/utils";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageItem } from "@/components/chat/MessageItem";
import { MessageMemoryTag } from "@/components/chat/message-memory-tag";

// 复用聊天页同一套渲染件（Conversation + MessageItem + 贴底滚动），观感与 AI 对话框一致；
// 额外在跨天处插入日期分隔条，便于核对会话的真实时间范围。接口已是时间正序（旧→新）。
function dayKey(at: Date): string {
  return at.toLocaleDateString("en-CA"); // YYYY-MM-DD（本地时区，稳定可比）
}

function dayLabel(at: Date): string {
  return at.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

export function SessionMessages({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=300`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (res.status === 404) {
          // 原会话已删除：不是错误，分析与沉淀仍在，体面降级。
          setMissing(true);
          return;
        }
        if (!res.ok || !data) {
          setError(data?.error || `无法加载对话（HTTP ${res.status}）`);
          return;
        }
        setMessages((data.messages || []) as Message[]);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "无法加载对话");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在加载对话...
      </div>
    );
  }
  if (missing) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm leading-6 text-muted-foreground">
        原会话已删除，无法回看对话。
        <br />
        本会话的分析、进化建议与沉淀经验已独立保留，可在「会话总结」查看。
      </div>
    );
  }
  if (error) {
    return <div className="flex flex-1 items-center justify-center text-sm text-rose-700">{error}</div>;
  }
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        这个会话没有可显示的消息。
      </div>
    );
  }

  let prevDay = "";

  return (
    <Conversation>
      <ConversationContent className="mx-auto max-w-3xl gap-6 px-4 py-6">
        {messages.map((message) => {
          const at = parseDBDate(message.created_at);
          const key = dayKey(at);
          const showDivider = key !== prevDay;
          prevDay = key;
          return (
            <Fragment key={message.id}>
              {showDivider && (
                <div className="flex items-center justify-center py-1">
                  <span className="rounded-full border border-border bg-muted/40 px-3 py-0.5 text-xs text-muted-foreground">
                    {dayLabel(at)}
                  </span>
                </div>
              )}
              <div id={`msg-${message.id}`}>
                <MessageItem message={message} />
                <MessageMemoryTag messageId={message.id} />
              </div>
            </Fragment>
          );
        })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
