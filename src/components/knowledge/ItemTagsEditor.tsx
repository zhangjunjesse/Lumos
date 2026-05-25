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
  itemId: string;
  currentTags: string[];
  catalog: TagCatalogItem[];
  onChanged?: (nextTags: string[]) => void;
}

export function ItemTagsEditor({ itemId, currentTags, catalog, onChanged }: Props) {
  const [tags, setTags] = useState<string[]>(currentTags);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTags(currentTags);
  }, [currentTags]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const lowerSet = useMemo(
    () => new Set(tags.map((t) => t.toLowerCase())),
    [tags],
  );

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return catalog
      .filter((c) => !lowerSet.has(c.name.toLowerCase()))
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
      .slice(0, 12);
  }, [draft, catalog, lowerSet]);

  const persist = async (nextTags: string[]) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: nextTags }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "保存失败");
      }
      setTags(nextTags);
      onChanged?.(nextTags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = (name: string) => {
    const next = tags.filter((t) => t.toLowerCase() !== name.toLowerCase());
    void persist(next);
  };

  const add = (raw: string) => {
    const name = raw.trim().slice(0, 30);
    if (!name) return;
    if (lowerSet.has(name.toLowerCase())) {
      setDraft("");
      return;
    }
    const next = [...tags, name];
    setDraft("");
    setAdding(false);
    void persist(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">标签</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{tags.length} 个</span>
          <button
            onClick={() => {
              setEditing((v) => !v);
              setAdding(false);
              setDraft("");
              setError(null);
            }}
            className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {editing ? "完成" : "编辑"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{error}</div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tags.length === 0 && !editing ? (
          <span className="text-xs text-muted-foreground">暂无标签</span>
        ) : null}
        {tags.map((label) => {
          const meta = catalog.find((c) => c.name.toLowerCase() === label.toLowerCase());
          const color = meta?.color || "#6B7280";
          return (
            <span
              key={label}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs"
              style={editing ? { borderColor: color } : undefined}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
              {label}
              {editing ? (
                <button
                  onClick={() => remove(label)}
                  disabled={saving}
                  aria-label={`移除 ${label}`}
                  className="ml-1 text-muted-foreground hover:text-rose-600 disabled:opacity-50"
                >
                  ×
                </button>
              ) : null}
            </span>
          );
        })}

        {editing && !adding ? (
          <button
            onClick={() => setAdding(true)}
            disabled={saving}
            className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            + 添加
          </button>
        ) : null}
      </div>

      {editing && adding ? (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            placeholder="输入标签名,回车新建;或点下方选择"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/50"
            maxLength={30}
          />
          {suggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => add(s.name)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent/60 px-2 py-0.5 text-xs hover:bg-accent"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                  <span className="text-[10px] text-muted-foreground">({s.usage_count})</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-muted-foreground">
              {draft.trim() ? `回车新建「${draft.trim()}」` : "暂无可选标签,输入新名后回车"}
            </div>
          )}
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
              className="rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
