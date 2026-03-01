"use client";

import { useState, useEffect, useCallback } from "react";
import { AiEntryCard } from "@/components/workspace/ai-entry-card";
import { ContentList } from "@/components/workspace/content-list";
import { FilterTabs } from "@/components/workspace/filter-tabs";
import { KnowledgeStatusBar } from "@/components/workspace/knowledge-status-bar";
import { CreateMenu } from "@/components/workspace/create-menu";
import { EmptyState } from "@/components/workspace/empty-state";
import { useTranslation } from "@/hooks/useTranslation";

export interface ContentItem {
  id: string;
  type: "document" | "conversation";
  title: string;
  preview: string;
  updated_at: string;
  source_type?: string;
  kb_status?: string;
  message_count?: number;
  tags?: string;
  is_starred?: number;
}

export default function WorkspacePage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid";
    return (localStorage.getItem("lumos_view_mode") as "grid" | "list") || "grid";
  });
  const [filter, setFilter] = useState<string>("all");

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, convsRes] = await Promise.all([
        fetch("/api/documents"),
        fetch("/api/conversations"),
      ]);
      const docsData = docsRes.ok ? await docsRes.json() : [];
      const convsData = convsRes.ok ? await convsRes.json() : [];
      const docs = Array.isArray(docsData) ? docsData : (docsData.rows ?? []);
      const convs = Array.isArray(convsData) ? convsData : (convsData.rows ?? []);

      const merged: ContentItem[] = [
        ...docs.map((d: Record<string, unknown>) => ({
          id: d.id as string,
          type: "document" as const,
          title: (d.title as string) || "Untitled",
          preview: ((d.content as string) || "").slice(0, 120),
          updated_at: d.updated_at as string,
          source_type: d.source_type as string,
          kb_status: d.kb_status as string,
          tags: d.tags as string,
          is_starred: d.is_starred as number,
        })),
        ...convs.map((c: Record<string, unknown>) => ({
          id: c.id as string,
          type: "conversation" as const,
          title: (c.title as string) || "Untitled conversation",
          preview: (c.summary as string) || "",
          updated_at: c.updated_at as string,
          message_count: c.message_count as number,
          is_starred: c.is_starred as number,
        })),
      ];

      merged.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      setItems(merged);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const toggleView = useCallback(() => {
    setView((v) => {
      const next = v === "grid" ? "list" : "grid";
      localStorage.setItem("lumos_view_mode", next);
      return next;
    });
  }, []);

  const filtered = items.filter((item) => {
    if (filter === "documents") return item.type === "document";
    if (filter === "conversations") return item.type === "conversation";
    return true;
  });

  const isEmpty = !loading && items.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
          <AiEntryCard />

          {isEmpty ? (
            <EmptyState onRefresh={fetchItems} />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <FilterTabs value={filter} onChange={setFilter} />
                <div className="flex items-center gap-2">
                  <CreateMenu onCreated={fetchItems} />
                  <ViewToggle view={view} onToggle={toggleView} />
                </div>
              </div>
              <ContentList items={filtered} view={view} loading={loading} />
            </>
          )}
        </div>
      </div>

      <KnowledgeStatusBar />
    </div>
  );
}

function ViewToggle({ view, onToggle }: { view: string; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
    >
      {view === "grid" ? t('workspace.listView') : t('workspace.gridView')}
    </button>
  );
}
