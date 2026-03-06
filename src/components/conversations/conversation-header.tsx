"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";

interface ConversationHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  onBack: () => void;
}

export function ConversationHeader({
  title,
  onTitleChange,
  onBack,
}: ConversationHeaderProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== title) {
      onTitleChange(draft.trim());
    } else {
      setDraft(title);
    }
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
        <HugeiconsIcon icon={ArrowLeft} className="h-4 w-4" />
      </Button>

      {editing ? (
        <input
          className="flex-1 bg-transparent text-sm font-medium focus:outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          autoFocus
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="cursor-pointer truncate text-sm font-medium hover:text-primary"
              onClick={() => { setDraft(title); setEditing(true); }}
            >
              {title || "Untitled conversation"}
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('tooltip.editTitle')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
