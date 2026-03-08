"use client";

import { useMemo, useState } from "react";
import { useFavoritesStore } from "@/stores/favorites";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Favorite,
  File,
  Globe,
  Search,
  FolderOpen,
} from "@hugeicons/core-free-icons";
import type { FeishuDocItem } from "@/components/feishu/FeishuPanel";
import type { FavoriteType } from "@/stores/favorites";

interface FavoritesPanelProps {
  onOpenFile: (path: string) => void;
  onOpenFeishuDoc: (doc: FeishuDocItem) => void;
  onOpenUrl: (url: string) => void;
}

type FavoritesFilter = "all" | FavoriteType;

const FILTERS: FavoritesFilter[] = ["all", "file", "feishu-doc", "url"];
const FAVORITE_TYPE_ORDER: FavoriteType[] = ["file", "feishu-doc", "url"];

export function FavoritesPanel({
  onOpenFile,
  onOpenFeishuDoc,
  onOpenUrl,
}: FavoritesPanelProps) {
  const { t } = useTranslation();
  const items = useFavoritesStore((state) => state.items);
  const removeByKey = useFavoritesStore((state) => state.removeByKey);
  const touchByKey = useFavoritesStore((state) => state.touchByKey);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FavoritesFilter>("all");

  const normalizedQuery = query.trim().toLowerCase();

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filter !== "all" && item.type !== filter) return false;
      if (!normalizedQuery) return true;

      return (
        item.title.toLowerCase().includes(normalizedQuery) ||
        item.subtitle.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [filter, items, normalizedQuery]);

  const groupedItems = useMemo(() => {
    const bucket: Record<FavoriteType, typeof filteredItems> = {
      file: [],
      "feishu-doc": [],
      url: [],
    };
    for (const item of filteredItems) {
      bucket[item.type].push(item);
    }

    const typesToRender: FavoriteType[] =
      filter === "all"
        ? FAVORITE_TYPE_ORDER.filter((type) => bucket[type].length > 0)
        : [filter];

    return typesToRender.map((type) => ({
      type,
      items: bucket[type],
    }));
  }, [filter, filteredItems]);

  const formatUpdatedTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const openItem = (item: (typeof filteredItems)[number]) => {
    touchByKey(item.key);

    if (item.type === "file") {
      onOpenFile(item.path);
      return;
    }
    if (item.type === "feishu-doc") {
      onOpenFeishuDoc({
        token: item.token,
        title: item.title,
        type: item.docType,
        url: item.url,
        updatedTime: item.updatedTime,
      });
      return;
    }
    onOpenUrl(item.normalizedUrl || item.url);
  };

  const typeLabel = (type: FavoriteType): string => {
    switch (type) {
      case "file":
        return t("favorites.filterFile");
      case "feishu-doc":
        return t("favorites.filterFeishuDoc");
      case "url":
        return t("favorites.filterUrl");
      default:
        return type;
    }
  };

  const typeIcon = (type: FavoriteType) => {
    switch (type) {
      case "file":
        return FolderOpen;
      case "feishu-doc":
        return File;
      case "url":
        return Globe;
      default:
        return File;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <div className="relative">
          <HugeiconsIcon
            icon={Search}
            className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("favorites.searchPlaceholder")}
            className="h-8 pl-7 text-xs"
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {FILTERS.map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={filter === item ? "secondary" : "ghost"}
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => setFilter(item)}
              >
                {item === "all" ? t("favorites.filterAll") : typeLabel(item)}
              </Button>
            ))}
          </div>

          <span className="shrink-0 text-[11px] text-muted-foreground">
            {filteredItems.length}/{items.length}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        {filteredItems.length === 0 ? (
          <div className="rounded-2xl border bg-card p-6 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
              <HugeiconsIcon icon={Favorite} className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">
              {normalizedQuery ? t("favorites.emptySearch") : t("favorites.empty")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groupedItems.map((group) => (
              <section
                key={group.type}
                className="overflow-hidden rounded-xl border bg-card/70"
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <HugeiconsIcon
                      icon={typeIcon(group.type)}
                      className="h-3.5 w-3.5 text-muted-foreground"
                    />
                    <span className="text-xs font-medium">{typeLabel(group.type)}</span>
                  </div>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {group.items.length}
                  </Badge>
                </div>

                <div className="space-y-1.5 p-1.5">
                  {group.items.map((item) => (
                    <div
                      key={item.key}
                      className="group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50"
                    >
                      <button
                        type="button"
                        onClick={() => openItem(item)}
                        className="min-w-0 flex flex-1 items-center gap-2 text-left"
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                          <HugeiconsIcon icon={typeIcon(item.type)} className="h-3.5 w-3.5" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium leading-tight">{item.title}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {item.subtitle}
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-1">
                        <span className="hidden text-[10px] text-muted-foreground lg:inline">
                          {formatUpdatedTime(item.updatedAt)}
                        </span>
                        <button
                          type="button"
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity",
                            "hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
                          )}
                          onClick={() => removeByKey(item.key)}
                          title={t("common.removeFromFavorites")}
                          aria-label={t("common.removeFromFavorites")}
                        >
                          <HugeiconsIcon
                            icon={Favorite}
                            className="size-3 text-amber-500"
                            fill="currentColor"
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
