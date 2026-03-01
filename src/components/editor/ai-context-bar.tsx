"use client";

import { Paperclip } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

interface ContextItem {
  label: string;
  detail?: string;
}

interface Props {
  documentTitle?: string;
  wordCount?: number;
  selectedText?: string;
  knowledgeCount?: number;
}

export function AiContextBar({
  documentTitle,
  wordCount,
  selectedText,
  knowledgeCount,
}: Props) {
  const { t } = useTranslation();
  const items: ContextItem[] = [];

  if (documentTitle) {
    items.push({
      label: t('editor.currentDocument'),
      detail: wordCount ? `(${wordCount.toLocaleString()} chars)` : undefined,
    });
  }

  if (selectedText) {
    const preview =
      selectedText.length > 30
        ? selectedText.slice(0, 30) + "..."
        : selectedText;
    items.push({ label: t('editor.selectedText'), detail: `"${preview}"` });
  }

  if (knowledgeCount && knowledgeCount > 0) {
    items.push({
      label: t('editor.knowledgeBase'),
      detail: `(${knowledgeCount} docs)`,
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="border-b bg-muted/30 px-3 py-2">
      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Paperclip className="size-3" />
        {t('editor.context')}
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li
            key={item.label}
            className="truncate text-xs text-muted-foreground"
          >
            <span className="mr-1">&#8226;</span>
            {item.label}
            {item.detail && (
              <span className="ml-1 text-muted-foreground/70">
                {item.detail}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
