"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { SendHorizonal, Square } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function AiPanelInput({ onSend, onStop, loading, disabled }: Props) {
  const [text, setText] = useState("");
  const { t } = useTranslation();

  const quickActions = [
    { label: t('editor.continue'), prompt: "Continue writing from where the document left off." },
    { label: t('editor.polish'), prompt: "Polish the selected text, keep the original meaning." },
    { label: t('editor.translate'), prompt: "Translate to English." },
    { label: t('editor.summarize'), prompt: "Summarize the key points." },
    { label: t('editor.qa'), prompt: "Answer questions about this document." },
  ];
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [text, loading, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 96) + "px"; // max 4 lines
  };

  return (
    <div className="border-t bg-background px-3 py-2">
      {/* Quick action buttons */}
      <div className="mb-2 flex gap-1 overflow-x-auto">
        {quickActions.map((a) => (
          <Button
            key={a.label}
            variant="outline"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={loading || disabled}
            onClick={() => onSend(a.prompt)}
          >
            {a.label}
          </Button>
        ))}
      </div>

      {/* Input area */}
      <div className="flex items-end gap-1.5">
        <textarea
          ref={textareaRef}
          className="flex-1 resize-none rounded-md border bg-transparent px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t('editor.askAiPlaceholder')}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={disabled}
        />
        {loading ? (
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onStop}>
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 w-8 p-0"
            onClick={send}
            disabled={!text.trim() || disabled}
          >
            <SendHorizonal className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
