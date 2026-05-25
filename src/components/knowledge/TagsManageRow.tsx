"use client";

import { CATEGORY_LABEL, type TagRow } from "./TagsManageTypes";

export function TagsManageRow({
  tag,
  busy,
  checked,
  onToggle,
  onRename,
  onMerge,
  onDelete,
}: {
  tag: TagRow;
  busy: boolean;
  checked: boolean;
  onToggle: () => void;
  onRename: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-3 rounded-md border px-2 py-2 ${
        checked
          ? "border-primary/40 bg-primary/5"
          : "border-transparent hover:border-border hover:bg-accent/40"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer"
      />
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: tag.color || "#6B7280" }}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm">{tag.name}</span>
        <span className="text-[11px] text-muted-foreground">
          {CATEGORY_LABEL[tag.category] || tag.category}
        </span>
        <span className="text-[11px] text-muted-foreground">· {tag.usage_count} 条</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button onClick={onRename} disabled={busy} className="rounded px-2 py-0.5 text-xs hover:bg-accent">
          改名
        </button>
        <button onClick={onMerge} disabled={busy} className="rounded px-2 py-0.5 text-xs hover:bg-accent">
          合并到…
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          className="rounded px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50"
        >
          删除
        </button>
      </div>
    </div>
  );
}
