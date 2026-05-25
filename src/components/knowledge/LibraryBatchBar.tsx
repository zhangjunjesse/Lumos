"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface TagCatalogItem {
  id: string;
  name: string;
  category: string;
  color: string;
  usage_count: number;
}

interface Props {
  count: number;
  catalog: TagCatalogItem[];
  candidateRemoveTags: string[];
  busyText?: string | null;
  onAddTag: (name: string) => Promise<void> | void;
  onRemoveTag: (name: string) => Promise<void> | void;
  onClear: () => void;
}

type Mode = null | "add" | "remove";

export function LibraryBatchBar({
  count,
  catalog,
  candidateRemoveTags,
  busyText,
  onAddTag,
  onRemoveTag,
  onClear,
}: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mode) inputRef.current?.focus();
  }, [mode]);

  const switchMode = (next: Mode) => {
    setMode((cur) => (cur === next ? null : next));
    setDraft("");
  };

  const addSuggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return catalog
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
      .slice(0, 12);
  }, [catalog, draft]);

  const removeOptions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return candidateRemoveTags.filter((name) =>
      q ? name.toLowerCase().includes(q) : true,
    );
  }, [candidateRemoveTags, draft]);

  return (
    <div className="mb-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">已选 {count} 条资料</span>
        {busyText ? <span className="text-muted-foreground">· {busyText}</span> : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => switchMode("add")}
            className={`rounded px-2 py-0.5 transition-colors ${
              mode === "add" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            }`}
          >
            批量加标签
          </button>
          <button
            onClick={() => switchMode("remove")}
            disabled={candidateRemoveTags.length === 0}
            className={`rounded px-2 py-0.5 transition-colors disabled:opacity-50 ${
              mode === "remove" ? "bg-rose-600 text-white" : "hover:bg-accent"
            }`}
          >
            批量删标签
          </button>
          <button
            onClick={onClear}
            className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent"
          >
            取消选择
          </button>
        </div>
      </div>

      {mode === "add" ? (
        <div className="mt-2 rounded-lg border border-border bg-background p-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const name = draft.trim();
                if (name) {
                  void onAddTag(name);
                  setDraft("");
                }
              } else if (e.key === "Escape") {
                switchMode(null);
              }
            }}
            placeholder="输入标签名,回车给所有选中资料加上;或从下方选已有"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/50"
            maxLength={30}
          />
          {addSuggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {addSuggestions.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    void onAddTag(t.name);
                    setDraft("");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent/60 px-2 py-0.5 text-xs hover:bg-accent"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                  <span className="text-[10px] text-muted-foreground">({t.usage_count})</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-muted-foreground">
              {draft.trim() ? `回车新建并加上「${draft.trim()}」` : "暂无可选,输入新名后回车新建"}
            </div>
          )}
        </div>
      ) : null}

      {mode === "remove" ? (
        <div className="mt-2 rounded-lg border border-border bg-background p-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="搜索要从这批资料里移除的标签"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/50"
          />
          {removeOptions.length > 0 ? (
            <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {removeOptions.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    void onRemoveTag(name);
                    setDraft("");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-100"
                >
                  × {name}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-muted-foreground">这批资料里没有匹配的标签</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
