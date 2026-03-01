"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ConversationHeader } from "@/components/conversations/conversation-header";
import { ContextBar } from "@/components/conversations/context-bar";
import { MessageFlow } from "@/components/conversations/message-flow";
import { QuickActions } from "@/components/conversations/quick-actions";
import { ConversationInput } from "@/components/conversations/conversation-input";

export interface ConvMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  references?: string;
  created_at: string;
}

interface Conversation {
  id: string;
  title: string;
  tags: string;
  message_count: number;
}

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [streaming, setStreaming] = useState(false);

  const fetchConversation = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setConv(data);
    setMessages(data.messages ?? []);
  }, [id]);

  useEffect(() => {
    fetchConversation();
  }, [fetchConversation]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      const userMsg: ConvMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);

      const assistantMsg: ConvMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        const res = await fetch(`/api/conversations/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });

        if (!res.ok || !res.body) throw new Error("Failed");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: buffer } : m
            )
          );
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: "Something went wrong." }
              : m
          )
        );
      } finally {
        setStreaming(false);
      }
    },
    [id, streaming]
  );

  const updateTitle = useCallback(
    async (title: string) => {
      await fetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setConv((prev) => (prev ? { ...prev, title } : prev));
    },
    [id]
  );

  if (!conv) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <ConversationHeader
        title={conv.title}
        onTitleChange={updateTitle}
        onBack={() => router.push("/")}
      />
      <ContextBar />
      <MessageFlow messages={messages} />
      <QuickActions onAction={sendMessage} disabled={streaming} />
      <ConversationInput onSend={sendMessage} disabled={streaming} />
    </div>
  );
}
