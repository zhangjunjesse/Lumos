"use client";

import { useState, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { BookOpen01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";

interface KbStatus {
  total: number;
  indexed: number;
  indexing: number;
  status: "ready" | "indexing" | "empty";
}

export function KnowledgeStatusBar() {
  const { t } = useTranslation();
  const [kb, setKb] = useState<KbStatus | null>(null);

  useEffect(() => {
    fetch("/api/knowledge/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setKb({
            total: data.total_documents ?? 0,
            indexed: data.indexed_documents ?? 0,
            indexing: data.indexing_documents ?? 0,
            status: data.indexing_documents > 0
              ? "indexing"
              : data.indexed_documents > 0
                ? "ready"
                : "empty",
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!kb) return null;

  const dot =
    kb.status === "ready"
      ? "bg-green-500"
      : kb.status === "indexing"
        ? "bg-yellow-500 animate-pulse"
        : "bg-gray-400";

  const label =
    kb.status === "ready"
      ? t('knowledge.readyStatus', { n: kb.indexed })
      : kb.status === "indexing"
        ? t('knowledge.indexingStatus', { n: kb.indexing })
        : t('knowledge.emptyStatus');

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t bg-muted/50 px-4 text-xs text-muted-foreground">
      <HugeiconsIcon icon={BookOpen01Icon} className="h-3.5 w-3.5" />
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label}</span>
      <div className="flex-1" />
      <button
        type="button"
        className="text-xs hover:text-foreground transition-colors"
      >
        {t('knowledge.manage')}
      </button>
    </div>
  );
}
