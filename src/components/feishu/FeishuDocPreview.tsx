"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add, Loading, BookOpen } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";
import type { FeishuDocItem } from "./FeishuPanel";

interface FeishuDocPreviewProps {
  doc: FeishuDocItem;
  title: string;
  url?: string;
  onAddToChat?: (doc: FeishuDocItem) => Promise<void>;
  onAddToLibrary?: (doc: FeishuDocItem) => Promise<void>;
}

export function FeishuDocPreview({ doc, title, url, onAddToChat, onAddToLibrary }: FeishuDocPreviewProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [addingToLibrary, setAddingToLibrary] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!onAddToChat) return;
    setAdding(true);
    setMessage(null);
    try {
      await onAddToChat(doc);
      setMessage(t('feishu.attachSuccess').replace('{name}', title));
    } catch (error) {
      const text = error instanceof Error ? error.message : t('feishu.attachFailed');
      setMessage(text);
    } finally {
      setAdding(false);
    }
  };

  const handleAddToLibrary = async () => {
    if (!onAddToLibrary) return;
    setAddingToLibrary(true);
    setMessage(null);
    try {
      await onAddToLibrary(doc);
      setMessage(t('common.addedToLibrary'));
    } catch (error) {
      const text = error instanceof Error ? error.message : t('feishu.attachFailed');
      setMessage(text);
    } finally {
      setAddingToLibrary(false);
    }
  };

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t("feishu.docMissingUrl")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="truncate text-sm font-medium">{title}</p>
        <div className="flex items-center gap-1">
          {onAddToChat && (
            <button
              type="button"
              className="flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-muted"
              onClick={handleAdd}
              disabled={adding}
              title={t('common.addToChat')}
              aria-label={t('common.addToChat')}
            >
              {adding ? (
                <HugeiconsIcon icon={Loading} className="size-3 animate-spin text-muted-foreground" />
              ) : (
                <HugeiconsIcon icon={Add} className="size-3 text-muted-foreground" />
              )}
            </button>
          )}
          {onAddToLibrary && (
            <button
              type="button"
              className="flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-muted"
              onClick={handleAddToLibrary}
              disabled={addingToLibrary}
              title={t('common.addToLibrary')}
              aria-label={t('common.addToLibrary')}
            >
              {addingToLibrary ? (
                <HugeiconsIcon icon={Loading} className="size-3 animate-spin text-muted-foreground" />
              ) : (
                <HugeiconsIcon icon={BookOpen} className="size-3 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          {message}
        </div>
      )}

      <iframe
        src={url}
        title={title}
        className="h-full w-full border-0"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
      />
    </div>
  );
}
