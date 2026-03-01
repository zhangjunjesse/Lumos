"use client";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

interface KbItem {
  id: string;
  title: string;
  source_type: string;
  source_path: string;
  tags: string;
  updated_at: string;
}

interface Props {
  items: KbItem[];
  onDelete: (id: string) => void;
}

const sourceKeyMap: Record<string, TranslationKey> = {
  local_file: "knowledge.sourceFile",
  feishu: "knowledge.sourceFeishu",
  manual: "knowledge.sourceManual",
  webpage: "knowledge.sourceWeb",
};

export function ItemList({ items, onDelete }: Props) {
  const { t } = useTranslation();

  if (!items.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("knowledge.noItems")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const tags: string[] = (() => {
          try { return JSON.parse(item.tags); }
          catch { return []; }
        })();

        return (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-md border p-3"
          >
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-medium">
                {item.title}
              </h4>
              <div className="mt-1 flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {sourceKeyMap[item.source_type] ? t(sourceKeyMap[item.source_type]) : item.source_type}
                </span>
                {tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-xs text-muted-foreground">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive cursor-pointer"
              onClick={() => onDelete(item.id)}
            >
              {t("common.delete")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
