"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Sparkles,
  Cancel,
  Pin,
  File,
  Message,
  ArrowUp01,
} from "@hugeicons/core-free-icons";
import { AssistantMessage } from "./assistant-message";

interface AssistantModalProps {
  onClose: () => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface RecentConversation {
  id: string;
  title: string;
  updated_at: string;
}

export function AssistantModal({ onClose }: AssistantModalProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [recent, setRecent] = useState<RecentConversation[]>([]);
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Cmd+K to close when already open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Fetch recent conversations
  useEffect(() => {
    fetch("/api/conversations?limit=5&sort=updated_at")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRecent(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const inConversation = messages.length > 0;

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch("/api/ai-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
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
            ? { ...m, content: "Sorry, something went wrong." }
            : m
        )
      );
    } finally {
      setStreaming(false);
    }
  }, [input, messages, streaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const pinConversation = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-assistant/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onClose();
        router.push(`/conversations/${data.id}`);
      }
    } catch {
      // ignore
    }
  }, [messages, onClose, router]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "w-full max-w-[640px] rounded-xl border bg-popover shadow-2xl",
          "flex flex-col overflow-hidden",
          inConversation ? "max-h-[70vh]" : "max-h-[400px]"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <HugeiconsIcon icon={Sparkles} className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{t('aiAssistant.title')}</span>
          <div className="flex-1" />
          {inConversation && (
            <>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={pinConversation}>
                <HugeiconsIcon icon={Pin} className="h-3.5 w-3.5" />
                Save
              </Button>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                <HugeiconsIcon icon={File} className="h-3.5 w-3.5" />
                To Doc
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <HugeiconsIcon icon={Cancel} className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        {inConversation ? (
          <ConversationBody messages={messages} scrollRef={scrollRef} />
        ) : (
          <IdleBody recent={recent} onClose={onClose} />
        )}

        {/* Input */}
        <div className="border-t px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              className="max-h-24 min-h-[36px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t('aiAssistant.placeholder')}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={!input.trim() || streaming}
              onClick={handleSend}
            >
              <HugeiconsIcon icon={ArrowUp01} className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Idle state: recent conversations + quick actions */
function IdleBody({
  recent,
  onClose,
}: {
  recent: RecentConversation[];
  onClose: () => void;
}) {
  const router = useRouter();

  return (
    <div className="flex-1 overflow-auto px-4 py-3">
      {recent.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Recent conversations
          </p>
          <div className="space-y-1">
            {recent.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => {
                  onClose();
                  router.push(`/conversations/${c.id}`);
                }}
              >
                <HugeiconsIcon icon={Message} className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">{c.title || "Untitled"}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatRelative(c.updated_at)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Quick actions
        </p>
        <div className="flex flex-wrap gap-2">
          <QuickAction label="New document" onClick={() => { onClose(); router.push("/documents"); }} />
          <QuickAction label="New conversation" onClick={() => { onClose(); router.push("/conversations/new"); }} />
          <QuickAction label="Import file" onClick={() => { onClose(); }} />
        </div>
      </div>
    </div>
  );
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** Conversation body with message list */
function ConversationBody({
  messages,
  scrollRef,
}: {
  messages: Message[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <ScrollArea className="flex-1">
      <div ref={scrollRef} className="space-y-4 px-4 py-3">
        {messages.map((msg) => (
          <AssistantMessage key={msg.id} role={msg.role} content={msg.content} />
        ))}
      </div>
    </ScrollArea>
  );
}

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}
