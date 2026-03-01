"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";

interface ConversationInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function ConversationInput({ onSend, disabled }: ConversationInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const text = input.trim();
    if (!text || disabled) return;
    onSend(text);
    setInput("");
    ref.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={ref}
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t('conversation.inputPlaceholder')}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          size="icon"
          className="h-10 w-10 shrink-0"
          disabled={!input.trim() || disabled}
          onClick={handleSend}
        >
          <HugeiconsIcon icon={ArrowUp01Icon} className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
