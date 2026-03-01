"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { KbStatCards } from "./kb-stat-cards";
import { KbDocList } from "./kb-doc-list";
import { useTranslation } from "@/hooks/useTranslation";

interface KbDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface KbStats {
  total_documents: number;
  total_chunks: number;
  storage_bytes: number;
  indexed_documents: number;
  indexing_documents: number;
  failed_documents: number;
}

interface KbDoc {
  id: string;
  title: string;
  source_type: string;
  kb_status: string;
  word_count: number;
  updated_at: string;
}

export function KbDrawer({ open, onOpenChange }: KbDrawerProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<KbStats | null>(null);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, docsRes] = await Promise.all([
        fetch("/api/knowledge/health"),
        fetch("/api/documents?kb_enabled=1"),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (docsRes.ok) {
        const data = await docsRes.json();
        setDocs(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  const filtered = docs.filter((d) =>
    d.title.toLowerCase().includes(search.toLowerCase())
  );

  const reindexAll = async () => {
    for (const doc of docs) {
      await fetch(`/api/documents/${doc.id}/reindex`, { method: "POST" });
    }
    fetchData();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle>{t('kbDrawer.title')}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Stats */}
          {stats && <KbStatCards stats={stats} />}

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-5 py-3 border-b">
            <input
              className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
              placeholder={t('kbDrawer.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={reindexAll}>
              Rebuild all
            </Button>
          </div>

          {/* Document list */}
          <ScrollArea className="flex-1">
            <KbDocList docs={filtered} onRefresh={fetchData} />
          </ScrollArea>

          {/* Capacity bar */}
          {stats && <CapacityBar stats={stats} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CapacityBar({ stats }: { stats: KbStats }) {
  const { t } = useTranslation();
  const maxBytes = 100 * 1024 * 1024; // 100MB
  const pct = Math.min(100, (stats.storage_bytes / maxBytes) * 100);
  const color =
    pct > 95 ? "bg-red-500" : pct > 80 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="border-t px-5 py-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>{t('kbDrawer.storage')}</span>
        <span>{formatBytes(stats.storage_bytes)} / 100 MB</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
