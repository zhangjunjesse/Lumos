'use client';

import * as React from 'react';
import { ChevronRight, ChevronDown, X } from 'lucide-react';

import {
  ETSY_CATEGORY_CATALOG,
  buildLeafIndex,
  resolveCatalogTargets,
  type CatalogNode,
} from '@/lib/ecommerce-assistant/category-catalog';

/** 范围较大阈值：每个细分类目最多 12 个 listing 逐 tag EHunt hover，耗时分钟级。 */
const LARGE_SCOPE = 6;

interface CategoryPickerProps {
  /** 已选**叶子** id 集合（父类点选会展开为其全部叶子写入此集合）。 */
  selected: Set<string>;
  expanded: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onExp: (id: string) => void;
  onClear: () => void;
}

/**
 * 类目选择器（纯内容体，无 Card / 启动按钮）—— 由 NewResearchDialog 弹框
 * 承载，弹框负责标题、底部「生成报告」动作与错误展示。这里只管：树选择、
 * 已选范围预览、范围过大提示、清空。
 */
export function CategoryPicker({
  selected,
  expanded,
  onSelectionChange,
  onExp,
  onClear,
}: CategoryPickerProps): React.ReactElement {
  // 静态目录 → 每节点的叶子集（一次构建）。选择以叶子为单位：树视觉与
  // runner 实际采集完全一致，且能从已选父类中单独排除某个叶子。
  const leafIndex = React.useMemo(() => buildLeafIndex(), []);
  const targets = React.useMemo(
    () => resolveCatalogTargets([...selected]),
    [selected],
  );
  const large = targets.length > LARGE_SCOPE;

  const toggleNode = React.useCallback(
    (id: string) => {
      const leaves = leafIndex.get(id) ?? [id];
      const allSel = leaves.length > 0 && leaves.every((l) => selected.has(l));
      const next = new Set(selected);
      for (const l of leaves) {
        if (allSel) next.delete(l);
        else next.add(l);
      }
      onSelectionChange(next);
    },
    [leafIndex, selected, onSelectionChange],
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        内置 Etsy 大类清单（精选种子树，非官方全量）。勾父类即勾选其全部细分，可再单独取消。
      </p>
      <div className="max-h-[340px] overflow-y-auto rounded border p-1">
        {ETSY_CATEGORY_CATALOG.map((n) => (
          <TreeRow
            key={n.id}
            node={n}
            depth={0}
            selected={selected}
            expanded={expanded}
            leafIndex={leafIndex}
            onToggle={toggleNode}
            onExp={onExp}
          />
        ))}
      </div>

      {targets.length > 0 ? (
        <div className="rounded border bg-muted/40 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span>
              已选 <b>{targets.length}</b> 个细分类目（实际采集范围）
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
              onClick={onClear}
            >
              <X className="size-3" />
              清空
            </button>
          </div>
          <p className="mt-1 text-muted-foreground">
            {targets.slice(0, 10).map((t) => t.name).join('、')}
            {targets.length > 10 ? ` 等 ${targets.length} 项` : ''}
          </p>
          {large ? (
            <p className="mt-1 text-amber-600 dark:text-amber-500">
              范围较大：{targets.length} 个细分 × 每类最多 12 商品逐 tag EHunt
              hover，可能耗时数十分钟，建议分批运行。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selected,
  expanded,
  leafIndex,
  onToggle,
  onExp,
}: {
  node: CatalogNode;
  depth: number;
  selected: Set<string>;
  expanded: Set<string>;
  leafIndex: Map<string, string[]>;
  onToggle: (id: string) => void;
  onExp: (id: string) => void;
}): React.ReactElement {
  const hasChildren = !!node.children?.length;
  const isOpen = expanded.has(node.id);
  const leaves = leafIndex.get(node.id) ?? [node.id];
  const selCount = leaves.reduce((n, l) => n + (selected.has(l) ? 1 : 0), 0);
  const checked = selCount > 0 && selCount === leaves.length;
  const indeterminate = selCount > 0 && selCount < leaves.length;

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent"
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        {hasChildren ? (
          <button type="button" onClick={() => onExp(node.id)} aria-label="展开">
            {isOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="inline-block w-3.5" />
        )}
        <label className="flex flex-1 cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={checked}
            ref={(el) => {
              if (el) el.indeterminate = indeterminate;
            }}
            onChange={() => onToggle(node.id)}
          />
          {node.name}
          {hasChildren ? (
            <span className="text-muted-foreground">
              （{selCount}/{leaves.length}）
            </span>
          ) : null}
        </label>
      </div>
      {hasChildren && isOpen
        ? node.children!.map((c) => (
            <TreeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              leafIndex={leafIndex}
              onToggle={onToggle}
              onExp={onExp}
            />
          ))
        : null}
    </div>
  );
}
