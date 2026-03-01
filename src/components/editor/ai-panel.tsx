"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Pin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import { AiPanelTabs } from "./ai-panel-tabs";
import { AiContextBar } from "./ai-context-bar";
import { AiChatMessages, type ChatMessage } from "./ai-chat-messages";
import { AiPanelInput } from "./ai-panel-input";

interface Props {
  documentTitle?: string;
  wordCount?: number;
  selectedText?: string;
  knowledgeCount?: number;
  onClose?: () => void;
  onApplyToDocument?: (content: string) => void;
  className?: string;
}

export function AiPanel({
  documentTitle,
  wordCount,
  selectedText,
  knowledgeCount,
  onClose,
  onApplyToDocument,
  className,
}: Props) {
  const [activeTab, setActiveTab] = useState("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [pinned, setPinned] = useState(false);
  const { t } = useTranslation();

  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            context: selectedText || undefined,
            mode: "document",
          }),
        });

        const reply = res.ok ? await res.text() : t('editor.failedResponse');
        const aiMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, aiMsg]);
      } finally {
        setLoading(false);
      }
    },
    [selectedText]
  );

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const handleRetry = useCallback(
    (messageId: string) => {
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx <= 0) return;
      const userMsg = messages[idx - 1];
      if (userMsg?.role === "user") {
        setMessages((prev) => prev.slice(0, idx));
        sendMessage(userMsg.content);
      }
    },
    [messages, sendMessage]
  );

  return (
    <div className={cn("flex h-full flex-col border-l bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">{t('editor.aiAssistant')}</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-6 w-6 p-0", pinned && "text-blue-500")}
            onClick={() => setPinned(!pinned)}
            title={t('editor.pinPanel')}
          >
            <Pin className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onClose}
            title={t('editor.closePanel')}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Context bar */}
      <AiContextBar
        documentTitle={documentTitle}
        wordCount={wordCount}
        selectedText={selectedText}
        knowledgeCount={knowledgeCount}
      />

      {/* Tabs + content */}
      <AiPanelTabs activeTab={activeTab} onTabChange={setActiveTab}>
        <div className="flex h-full flex-col">
          <AiChatMessages
            messages={messages}
            onApply={onApplyToDocument}
            onCopy={handleCopy}
            onRetry={handleRetry}
          />
          <AiPanelInput
            onSend={sendMessage}
            loading={loading}
            onStop={() => setLoading(false)}
          />
        </div>
      </AiPanelTabs>
    </div>
  );
}
