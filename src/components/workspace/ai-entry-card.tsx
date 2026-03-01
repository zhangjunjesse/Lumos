"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";

export function AiEntryCard() {
  const { t } = useTranslation();
  const router = useRouter();

  const placeholders = [
    t('workspace.placeholderProposal'),
    t('workspace.placeholderSummarize'),
    t('workspace.placeholderEmail'),
    t('workspace.placeholderMeeting'),
  ];

  const templates = [
    { label: t('workspace.templateBlankDoc'), icon: "📝" },
    { label: t('workspace.templateMeetingNotes'), icon: "📋" },
    { label: t('workspace.templateWeeklyReport'), icon: "📊" },
    { label: t('workspace.templateReadingNotes'), icon: "📖" },
    { label: t('workspace.templateTechSpec'), icon: "📑" },
  ];
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [input, setInput] = useState("");

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const createDocAndNavigate = async (title: string) => {
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || "" }),
      });
      if (res.ok) {
        const doc = await res.json();
        router.push(`/documents/${doc.id}`);
      }
    } catch { /* ignore */ }
  };

  const handleSubmit = () => {
    if (!input.trim()) return;
    createDocAndNavigate(input.trim());
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <HugeiconsIcon icon={SparklesIcon} className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t('workspace.whatCreate')}</span>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={placeholders[placeholderIdx]}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          onClick={handleSubmit}
        >
          {t('workspace.start')}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {templates.map((tpl) => (
          <button
            key={tpl.label}
            type="button"
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
            onClick={() => createDocAndNavigate(tpl.label)}
          >
            {tpl.icon} {tpl.label}
          </button>
        ))}
      </div>
    </div>
  );
}
