"use client";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

interface FilterTabsProps {
  value: string;
  onChange: (value: string) => void;
}

export function FilterTabs({ value, onChange }: FilterTabsProps) {
  const { t } = useTranslation();

  const filters = [
    { value: "all", label: t('workspace.filterAll') },
    { value: "documents", label: t('workspace.filterDocuments') },
    { value: "conversations", label: t('workspace.filterConversations') },
  ];
  return (
    <div className="flex gap-1">
      {filters.map((f) => (
        <button
          key={f.value}
          type="button"
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            value === f.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent"
          )}
          onClick={() => onChange(f.value)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
