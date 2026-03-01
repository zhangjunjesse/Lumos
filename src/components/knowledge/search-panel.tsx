"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface SearchResult {
  chunk_content: string;
  item_title: string;
  source_path: string;
  source_type: string;
  score: number;
  collection_name: string;
}

export function SearchPanel() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (res.ok) setResults(await res.json());
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          placeholder={t('knowledge.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
        />
        <Button size="sm" onClick={doSearch} disabled={searching}>
          {searching ? "..." : t('knowledge.search')}
        </Button>
      </div>

      {results.map((r, i) => (
        <div key={i} className="rounded-md border p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium text-sm">{r.item_title}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {r.score}%
            </span>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-3">
            {r.chunk_content}
          </p>
          {r.source_path && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {r.source_path}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
