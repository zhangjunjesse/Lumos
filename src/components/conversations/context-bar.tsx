"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { BookOpen } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";

export function ContextBar() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
      <HugeiconsIcon icon={BookOpen} className="h-3.5 w-3.5" />
      <span>{t('conversation.kbAvailable')}</span>
      <span className="text-[10px]">·</span>
      <span>{t('conversation.noDocsReferenced')}</span>
    </div>
  );
}
