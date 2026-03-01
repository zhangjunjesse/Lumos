"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/hooks/useTranslation";
import type { ContentItem } from "@/app/page";

interface ContentListProps {
  items: ContentItem[];
  view: "grid" | "list";
  loading: boolean;
}

export function ContentList({ items, view, loading }: ContentListProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        {t('workspace.noItemsMatch')}
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="space-y-1">
        {items.map((item) => (
          <ContentRow key={`${item.type}-${item.id}`} item={item} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <ContentCard key={`${item.type}-${item.id}`} item={item} />
      ))}
    </div>
  );
}

function ContentCard({ item }: { item: ContentItem }) {
  const router = useRouter();
  const { t } = useTranslation();
  const href =
    item.type === "document"
      ? `/documents/${item.id}`
      : `/conversations/${item.id}`;

  return (
    <Card
      className="cursor-pointer p-4 transition-colors hover:bg-accent"
      onClick={() => router.push(href)}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm">
          {item.type === "document" ? "📄" : "💬"}
        </span>
        <h3 className="truncate text-sm font-medium">{item.title}</h3>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {item.preview || t('workspace.empty')}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">
          {formatDate(item.updated_at)}
        </span>
        {item.kb_status === "indexed" && (
          <Badge variant="secondary" className="h-4 text-[10px]">
            {t('workspace.indexed')}
          </Badge>
        )}
        {item.message_count != null && (
          <Badge variant="outline" className="h-4 text-[10px]">
            {t('workspace.messageCount', { n: item.message_count })}
          </Badge>
        )}
      </div>
    </Card>
  );
}

function ContentRow({ item }: { item: ContentItem }) {
  const router = useRouter();
  const { t } = useTranslation();
  const href =
    item.type === "document"
      ? `/documents/${item.id}`
      : `/conversations/${item.id}`;

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent"
      onClick={() => router.push(href)}
    >
      <span className="text-sm shrink-0">
        {item.type === "document" ? "📄" : "💬"}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium">{item.title}</h3>
      </div>
      {item.kb_status === "indexed" && (
        <Badge variant="secondary" className="h-5 text-[10px] shrink-0">
          {t('workspace.indexed')}
        </Badge>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatDate(item.updated_at)}
      </span>
    </div>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString();
}
