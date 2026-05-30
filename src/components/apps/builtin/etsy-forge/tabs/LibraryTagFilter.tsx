'use client';

// 图库顶部标签筛选 chip：点标签只看带该标签的商品。

export function LibraryTagFilter({
  allTags,
  activeTags,
  onToggle,
  onClear,
}: {
  allTags: string[];
  activeTags: Set<string>;
  onToggle: (tag: string) => void;
  onClear: () => void;
}) {
  if (allTags.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">标签筛选</span>
      {allTags.map((t) => {
        const on = activeTags.has(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              on ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground'
            }`}
          >
            {t}
          </button>
        );
      })}
      {activeTags.size > 0 && (
        <button type="button" className="text-[11px] text-primary hover:underline" onClick={onClear}>
          清除筛选
        </button>
      )}
    </div>
  );
}
