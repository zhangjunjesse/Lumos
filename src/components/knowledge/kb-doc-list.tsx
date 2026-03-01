"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/hooks/useTranslation";

interface KbDoc {
  id: string;
  title: string;
  source_type: string;
  kb_status: string;
  word_count: number;
  updated_at: string;
}

interface KbDocListProps {
  docs: KbDoc[];
  onRefresh: () => void;
}

export function KbDocList({ docs, onRefresh }: KbDocListProps) {
  if (docs.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        No documents in knowledge base
      </p>
    );
  }

  const reindex = async (id: string) => {
    await fetch(`/api/documents/${id}/reindex`, { method: "POST" });
    onRefresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove from knowledge base?")) return;
    await fetch(`/api/documents/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kb_enabled: 0 }),
    });
    onRefresh();
  };

  return (
    <div className="divide-y">
      {docs.map((doc) => (
        <KbDocRow
          key={doc.id}
          doc={doc}
          onReindex={() => reindex(doc.id)}
          onRemove={() => remove(doc.id)}
        />
      ))}
    </div>
  );
}

function KbDocRow({
  doc,
  onReindex,
  onRemove,
}: {
  doc: KbDoc;
  onReindex: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const statusBadge = getStatusBadge(doc.kb_status);

  return (
    <div className="group flex items-center gap-3 px-5 py-3 hover:bg-accent/50">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{doc.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground">
            {doc.source_type}
          </span>
          <span className="text-xs text-muted-foreground">
            {doc.word_count} words
          </span>
        </div>
      </div>

      <Badge variant={statusBadge.variant} className="shrink-0 text-[10px]">
        {statusBadge.label}
      </Badge>

      <div className="hidden gap-1 group-hover:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" className="h-6 cursor-pointer text-xs" onClick={onReindex}>
              Reindex
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('tooltip.reindex')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" className="h-6 cursor-pointer text-xs text-destructive" onClick={onRemove}>
              Remove
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('tooltip.removeFromKb')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case "indexed":
      return { label: "Indexed", variant: "secondary" as const };
    case "indexing":
      return { label: "Indexing...", variant: "outline" as const };
    case "failed":
      return { label: "Failed", variant: "destructive" as const };
    case "pending":
      return { label: "Pending", variant: "outline" as const };
    default:
      return { label: status, variant: "outline" as const };
  }
}
