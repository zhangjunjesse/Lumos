"use client";

import { Button } from "@/components/ui/button";
import { Copy, RotateCcw, FileOutput } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

interface Props {
  messages: ChatMessage[];
  onApply?: (content: string) => void;
  onCopy?: (content: string) => void;
  onRetry?: (messageId: string) => void;
}

export function AiChatMessages({ messages, onApply, onCopy, onRetry }: Props) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-center text-sm text-muted-foreground">
          Ask AI to help with your document.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          onApply={onApply}
          onCopy={onCopy}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  onApply,
  onCopy,
  onRetry,
}: {
  message: ChatMessage;
  onApply?: (content: string) => void;
  onCopy?: (content: string) => void;
  onRetry?: (messageId: string) => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-blue-500 text-white"
            : "bg-muted text-foreground"
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>

        {!isUser && (
          <div className="mt-2 flex gap-1 border-t border-border/30 pt-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs"
              onClick={() => onApply?.(message.content)}
            >
              <FileOutput className="size-3" />
              Apply
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs"
              onClick={() => onCopy?.(message.content)}
            >
              <Copy className="size-3" />
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs"
              onClick={() => onRetry?.(message.id)}
            >
              <RotateCcw className="size-3" />
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
