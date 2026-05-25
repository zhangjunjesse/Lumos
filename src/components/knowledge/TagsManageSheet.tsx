"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TagsManageEditor } from "./TagsManageEditor";
import { TagsManageRow } from "./TagsManageRow";
import { type EditingState, type TagRow } from "./TagsManageTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

export function TagsManageSheet({ open, onOpenChange, onChanged }: Props) {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyText, setBusyText] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge/tags");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "加载失败");
      setTags(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    if (!open) {
      setSelected(new Set());
      setEditing(null);
      setFilter("");
    }
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, filter]);

  const batchTags = useMemo(
    () => tags.filter((t) => selected.has(t.id)),
    [tags, selected],
  );

  const closeEditor = () => {
    setEditing(null);
    setBusyText(null);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = async (action: () => Promise<Response>) => {
    setBusyId(editing?.tagId ?? null);
    try {
      const res = await action();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { message?: string; error?: string }).message
          || (data as { message?: string; error?: string }).error
          || "操作失败";
        setError(msg);
        return false;
      }
      setError(null);
      closeEditor();
      await load();
      onChanged?.();
      return true;
    } finally {
      setBusyId(null);
    }
  };

  const submitRename = async () => {
    if (!editing) return;
    const name = (editing.draftName || "").trim();
    if (!name) return;
    await apply(() =>
      fetch(`/api/knowledge/tags/${editing.tagId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category: editing.draftCategory }),
      }),
    );
  };

  const submitMerge = async () => {
    if (!editing || !editing.mergeTargetId) return;
    await apply(() =>
      fetch(`/api/knowledge/tags/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_id: editing.tagId, to_id: editing.mergeTargetId }),
      }),
    );
  };

  const submitDelete = async () => {
    if (!editing) return;
    await apply(() =>
      fetch(`/api/knowledge/tags/${editing.tagId}`, { method: "DELETE" }),
    );
  };

  const runBatch = async (
    ids: string[],
    label: string,
    perId: (id: string) => Promise<Response>,
  ) => {
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      setBusyText(`${label}中 ${i + 1}/${ids.length}…`);
      try {
        const res = await perId(ids[i]);
        if (!res.ok) failed += 1;
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) setError(`完成,但有 ${failed} 个失败,可重试`);
    else setError(null);
    setBusyText(null);
    closeEditor();
    setSelected(new Set());
    await load();
    onChanged?.();
  };

  const submitBatchDelete = async () => {
    if (!editing?.batchIds?.length) return;
    await runBatch(editing.batchIds, "删除", (id) =>
      fetch(`/api/knowledge/tags/${id}`, { method: "DELETE" }),
    );
  };

  const submitBatchMerge = async () => {
    if (!editing?.batchIds?.length || !editing.mergeTargetId) return;
    const toId = editing.mergeTargetId;
    await runBatch(editing.batchIds, "合并", (id) =>
      fetch(`/api/knowledge/tags/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_id: id, to_id: toId }),
      }),
    );
  };

  const currentEditingTag = editing && editing.tagId
    ? tags.find((t) => t.id === editing.tagId) || null
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(36rem,100vw)] sm:max-w-[36rem] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-3 border-b border-border">
          <SheetTitle className="text-base">管理标签</SheetTitle>
          <p className="text-xs text-muted-foreground">
            改名、合并、删除会立刻应用到所有引用此标签的资料。
          </p>
        </SheetHeader>

        <div className="px-6 py-3 border-b border-border">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索标签"
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary/50"
          />
        </div>

        {selected.size > 0 ? (
          <div className="flex items-center gap-2 border-b border-border bg-accent/40 px-6 py-2 text-xs">
            <span className="font-medium">已选 {selected.size} 个</span>
            <span className="text-muted-foreground">· 合计 {batchTags.reduce((a, t) => a + t.usage_count, 0)} 条引用</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() =>
                  setEditing({
                    mode: "batchMerge",
                    tagId: "",
                    name: "",
                    batchIds: Array.from(selected),
                  })
                }
                className="rounded px-2 py-0.5 hover:bg-accent"
              >
                批量合并到…
              </button>
              <button
                onClick={() =>
                  setEditing({
                    mode: "batchDelete",
                    tagId: "",
                    name: "",
                    batchIds: Array.from(selected),
                  })
                }
                className="rounded px-2 py-0.5 text-rose-600 hover:bg-rose-50"
              >
                批量删除
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent"
              >
                取消选择
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mx-6 mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              {tags.length === 0 ? "暂无标签" : "没有匹配的标签"}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((tag) => (
                <TagsManageRow
                  key={tag.id}
                  tag={tag}
                  busy={busyId === tag.id}
                  checked={selected.has(tag.id)}
                  onToggle={() => toggleSelect(tag.id)}
                  onRename={() =>
                    setEditing({
                      mode: "rename",
                      tagId: tag.id,
                      name: tag.name,
                      draftName: tag.name,
                      draftCategory: tag.category,
                    })
                  }
                  onMerge={() => setEditing({ mode: "merge", tagId: tag.id, name: tag.name })}
                  onDelete={() => setEditing({ mode: "delete", tagId: tag.id, name: tag.name })}
                />
              ))}
            </div>
          )}
        </div>

        {editing ? (
          <TagsManageEditor
            editing={editing}
            tag={currentEditingTag}
            tags={tags}
            batchTags={batchTags}
            busyText={busyText}
            onClose={closeEditor}
            onChangeDraft={(patch) => setEditing((cur) => (cur ? { ...cur, ...patch } : cur))}
            onSubmitRename={submitRename}
            onSubmitMerge={submitMerge}
            onSubmitDelete={submitDelete}
            onSubmitBatchDelete={submitBatchDelete}
            onSubmitBatchMerge={submitBatchMerge}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

