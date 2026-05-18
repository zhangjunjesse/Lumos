'use client';

import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { resolveCatalogTargets } from '@/lib/ecommerce-assistant/category-catalog';
import { CategoryPicker } from './CategoryPicker';

/**
 * 新建关键词调研弹框：把"选类目"从常驻面板收进模态——列表页才是主视图。
 * 选择状态由父级持有（关闭弹框不丢已选），生成成功后由父级关闭并刷新。
 */
export function NewResearchDialog({
  open,
  onOpenChange,
  selected,
  expanded,
  starting,
  err,
  onSelectionChange,
  onExp,
  onClear,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: Set<string>;
  expanded: Set<string>;
  starting: boolean;
  err: string | null;
  onSelectionChange: (next: Set<string>) => void;
  onExp: (id: string) => void;
  onClear: () => void;
  onStart: () => void;
}): React.ReactElement {
  const count = React.useMemo(
    () => resolveCatalogTargets([...selected]).length,
    [selected],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建关键词调研</DialogTitle>
          <DialogDescription>
            选择 Etsy 类目范围，逐 listing 经 EHunt hover 抓搜索量/竞争度，产出关键词分析报告。
          </DialogDescription>
        </DialogHeader>

        <CategoryPicker
          selected={selected}
          expanded={expanded}
          onSelectionChange={onSelectionChange}
          onExp={onExp}
          onClear={onClear}
        />

        {err ? <p className="text-xs text-red-500">{err}</p> : null}

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {count === 0 ? '未选类目' : `共 ${count} 个待采集`}
          </span>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={starting}
          >
            取消
          </Button>
          <Button onClick={onStart} disabled={starting || count === 0}>
            {starting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            <span className="ml-1">生成关键词报告</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
