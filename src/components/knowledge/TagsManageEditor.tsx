"use client";

import type { TagCategory, TagRow, EditingState } from "./TagsManageTypes";
import { CATEGORIES, CATEGORY_LABEL } from "./TagsManageTypes";

interface Props {
  editing: EditingState;
  tag: TagRow | null;
  tags: TagRow[];
  batchTags?: TagRow[];
  busyText?: string | null;
  onClose: () => void;
  onChangeDraft: (patch: Partial<EditingState>) => void;
  onSubmitRename: () => Promise<void> | void;
  onSubmitMerge: () => Promise<void> | void;
  onSubmitDelete: () => Promise<void> | void;
  onSubmitBatchDelete: () => Promise<void> | void;
  onSubmitBatchMerge: () => Promise<void> | void;
}

export function TagsManageEditor({
  editing,
  tag,
  tags,
  batchTags,
  busyText,
  onClose,
  onChangeDraft,
  onSubmitRename,
  onSubmitMerge,
  onSubmitDelete,
  onSubmitBatchDelete,
  onSubmitBatchMerge,
}: Props) {
  const isBatch = editing.mode === "batchDelete" || editing.mode === "batchMerge";
  if (!isBatch && !tag) return null;

  return (
    <div className="border-t border-border bg-muted/30 px-6 py-4">
      {editing.mode === "rename" && tag ? (
        <RenameForm editing={editing} tag={tag} onClose={onClose} onChangeDraft={onChangeDraft} onSubmit={onSubmitRename} />
      ) : editing.mode === "merge" && tag ? (
        <MergeForm editing={editing} tag={tag} tags={tags} onClose={onClose} onChangeDraft={onChangeDraft} onSubmit={onSubmitMerge} />
      ) : editing.mode === "delete" && tag ? (
        <DeleteForm editing={editing} tag={tag} onClose={onClose} onSubmit={onSubmitDelete} />
      ) : editing.mode === "batchDelete" && batchTags ? (
        <BatchDeleteForm batchTags={batchTags} busyText={busyText} onClose={onClose} onSubmit={onSubmitBatchDelete} />
      ) : editing.mode === "batchMerge" && batchTags ? (
        <BatchMergeForm
          editing={editing}
          batchTags={batchTags}
          tags={tags}
          busyText={busyText}
          onClose={onClose}
          onChangeDraft={onChangeDraft}
          onSubmit={onSubmitBatchMerge}
        />
      ) : null}
    </div>
  );
}

function sumUsage(rows: TagRow[]): number {
  return rows.reduce((acc, r) => acc + (r.usage_count || 0), 0);
}

function BatchDeleteForm({
  batchTags,
  busyText,
  onClose,
  onSubmit,
}: {
  batchTags: TagRow[];
  busyText?: string | null;
  onClose: () => void;
  onSubmit: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium">批量删除 {batchTags.length} 个标签</div>
      <div className="max-h-24 overflow-y-auto rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
        {batchTags.map((t) => t.name).join("、")}
      </div>
      <div className="text-[11px] text-muted-foreground">
        合计 {sumUsage(batchTags)} 条资料会移除这些标签,资料本身不删。
      </div>
      {busyText ? <div className="text-[11px] text-muted-foreground">{busyText}</div> : null}
      <FooterButtons onCancel={onClose} onSubmit={onSubmit} submitLabel="删除" danger />
    </div>
  );
}

function BatchMergeForm({
  editing,
  batchTags,
  tags,
  busyText,
  onClose,
  onChangeDraft,
  onSubmit,
}: {
  editing: EditingState;
  batchTags: TagRow[];
  tags: TagRow[];
  busyText?: string | null;
  onClose: () => void;
  onChangeDraft: (patch: Partial<EditingState>) => void;
  onSubmit: () => Promise<void> | void;
}) {
  const selectedIds = new Set(editing.batchIds || []);
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium">把 {batchTags.length} 个标签合并到…</div>
      <div className="max-h-20 overflow-y-auto rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
        {batchTags.map((t) => t.name).join("、")}
      </div>
      <select
        value={editing.mergeTargetId || ""}
        onChange={(e) => onChangeDraft({ mergeTargetId: e.target.value })}
        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary/50"
      >
        <option value="">选择目标标签</option>
        {tags
          .filter((t) => !selectedIds.has(t.id))
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}  ·  {CATEGORY_LABEL[t.category]}  ·  {t.usage_count} 条
            </option>
          ))}
      </select>
      <div className="text-[11px] text-muted-foreground">
        这些标签下合计 {sumUsage(batchTags)} 条资料会改挂到目标,源标签从标签库删除。
      </div>
      {busyText ? <div className="text-[11px] text-muted-foreground">{busyText}</div> : null}
      <FooterButtons onCancel={onClose} onSubmit={onSubmit} submitLabel="合并" submitDisabled={!editing.mergeTargetId} />
    </div>
  );
}

function RenameForm({
  editing,
  tag,
  onClose,
  onChangeDraft,
  onSubmit,
}: {
  editing: EditingState;
  tag: TagRow;
  onClose: () => void;
  onChangeDraft: (patch: Partial<EditingState>) => void;
  onSubmit: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium">改名「{editing.name}」</div>
      <input
        autoFocus
        value={editing.draftName || ""}
        onChange={(e) => onChangeDraft({ draftName: e.target.value })}
        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary/50"
        placeholder="新标签名"
      />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">分类</span>
        <select
          value={editing.draftCategory || tag.category}
          onChange={(e) => onChangeDraft({ draftCategory: e.target.value as TagCategory })}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <span className="ml-auto text-[11px] text-muted-foreground">影响 {tag.usage_count} 条资料</span>
      </div>
      <FooterButtons onCancel={onClose} onSubmit={onSubmit} submitLabel="保存" />
    </div>
  );
}

function MergeForm({
  editing,
  tag,
  tags,
  onClose,
  onChangeDraft,
  onSubmit,
}: {
  editing: EditingState;
  tag: TagRow;
  tags: TagRow[];
  onClose: () => void;
  onChangeDraft: (patch: Partial<EditingState>) => void;
  onSubmit: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium">把「{editing.name}」合并到…</div>
      <select
        value={editing.mergeTargetId || ""}
        onChange={(e) => onChangeDraft({ mergeTargetId: e.target.value })}
        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary/50"
      >
        <option value="">选择目标标签</option>
        {tags
          .filter((t) => t.id !== editing.tagId)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}  ·  {CATEGORY_LABEL[t.category]}  ·  {t.usage_count} 条
            </option>
          ))}
      </select>
      <div className="text-[11px] text-muted-foreground">
        「{editing.name}」的 {tag.usage_count} 条资料会改挂到目标标签,「{editing.name}」从标签库删除。
      </div>
      <FooterButtons
        onCancel={onClose}
        onSubmit={onSubmit}
        submitLabel="合并"
        submitDisabled={!editing.mergeTargetId}
      />
    </div>
  );
}

function DeleteForm({
  editing,
  tag,
  onClose,
  onSubmit,
}: {
  editing: EditingState;
  tag: TagRow;
  onClose: () => void;
  onSubmit: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium">删除「{editing.name}」</div>
      <div className="text-[11px] text-muted-foreground">
        会从 {tag.usage_count} 条资料移除这个标签,资料本身不删。
      </div>
      <FooterButtons onCancel={onClose} onSubmit={onSubmit} submitLabel="删除" danger />
    </div>
  );
}

function FooterButtons({
  onCancel,
  onSubmit,
  submitLabel,
  submitDisabled,
  danger,
}: {
  onCancel: () => void;
  onSubmit: () => Promise<void> | void;
  submitLabel: string;
  submitDisabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={onCancel}
        className="rounded-lg px-3 py-1.5 text-xs hover:bg-accent"
      >
        取消
      </button>
      <button
        onClick={() => void onSubmit()}
        disabled={submitDisabled}
        className={
          danger
            ? "rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            : "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        }
      >
        {submitLabel}
      </button>
    </div>
  );
}
