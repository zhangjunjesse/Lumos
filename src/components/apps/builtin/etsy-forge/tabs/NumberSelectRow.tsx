'use client';

// 设置里「数字下拉」块(图片并发度 / 抠姿势上限共用)。纯展示,选值即回调保存。

import { type ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function NumberSelectRow({
  title,
  desc,
  value,
  options,
  unit,
  onChange,
}: {
  title: string;
  desc: ReactNode;
  value: number;
  options: number[];
  unit: string;
  onChange: (n: number) => void;
}) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-1 text-sm font-medium">{title}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{desc}</p>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-9 w-32 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} {unit}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
