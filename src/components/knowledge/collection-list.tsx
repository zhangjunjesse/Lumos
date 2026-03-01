"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/hooks/useTranslation";

interface Collection {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

interface Props {
  collections: Collection[];
  selected: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function CollectionList({ collections, selected, onSelect, onDelete }: Props) {
  const { t } = useTranslation();
  if (!collections.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('knowledge.selectCollectionHint')}</p>;
  }

  return (
    <div className="space-y-2">
      {collections.map((c) => (
        <Card
          key={c.id}
          className={`cursor-pointer p-3 transition-colors hover:bg-accent ${
            selected === c.id ? "border-primary bg-accent" : ""
          }`}
          onClick={() => onSelect(c.id)}
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <h4 className="truncate font-medium">{c.name}</h4>
              {c.description && (
                <p className="truncate text-xs text-muted-foreground">{c.description}</p>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-2 h-7 shrink-0 text-xs text-destructive cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                >
                  {t('knowledge.delete')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('tooltip.deleteCollection')}</TooltipContent>
            </Tooltip>
          </div>
        </Card>
      ))}
    </div>
  );
}
