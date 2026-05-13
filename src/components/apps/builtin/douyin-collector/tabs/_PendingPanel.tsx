'use client';

import * as React from 'react';
import { CircleSlash } from 'lucide-react';

/**
 * 通用「未接入」面板，用于尚未实现的 Tab。比起空白页或 mock 数据，这种方式
 * 显式告诉用户「这个能力将在后续迭代落地」，符合内置级应用规范的诚实暴露要求。
 */
export function PendingPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>

      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
        <CircleSlash className="size-7 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-sm font-medium">下一轮迭代实现</p>
        <p className="max-w-md text-xs text-muted-foreground">
          目前仅展示页面壳。底层能力尚未接入，避免 mock 数据混淆。
        </p>
        {children}
      </div>
    </section>
  );
}
