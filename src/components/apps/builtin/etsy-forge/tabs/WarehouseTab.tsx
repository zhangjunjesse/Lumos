'use client';

// 灵感 tab —— 自动归集创作会话产出的生成图，按创建时间按小时分组。和底部创作助手共享同一个创作会话。

import { HugeiconsIcon } from '@hugeicons/react';
import { Loading } from '@hugeicons/core-free-icons';
import { useCreationSession } from './use-creation-session';
import { WarehouseView } from './WarehouseView';

export function WarehouseTab() {
  const s = useCreationSession();

  if (s.loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <HugeiconsIcon icon={Loading} className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (s.error) return <p className="p-6 text-center text-sm text-destructive">{s.error}</p>;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="mb-3 text-sm text-muted-foreground">创作产出的图自动归集在这里，按生成时间分组。hover 图片可放大或加回创作助手。</p>
      <WarehouseView messages={s.messages} />
    </div>
  );
}
