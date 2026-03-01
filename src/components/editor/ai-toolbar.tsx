"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  selectedText: string;
  onResult: (text: string) => void;
}

const actions = [
  { label: "Polish", prompt: "润色以下文本，保持原意，提升表达：" },
  { label: "Continue", prompt: "续写以下内容：" },
  { label: "Translate", prompt: "翻译为英文：" },
  { label: "Summarize", prompt: "总结以下内容要点：" },
] as const;

export function AiToolbar({ selectedText, onResult }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  const run = async (action: string, prompt: string) => {
    if (!selectedText.trim()) return;
    setLoading(action);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt + selectedText,
          mode: "chat",
        }),
      });
      if (res.ok) {
        const text = await res.text();
        onResult(text);
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex gap-1">
      {actions.map((a) => (
        <Button
          key={a.label}
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={!selectedText || loading !== null}
          onClick={() => run(a.label, a.prompt)}
        >
          {loading === a.label ? "..." : a.label}
        </Button>
      ))}
    </div>
  );
}
