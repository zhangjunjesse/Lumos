'use client';

// 二创方向矩阵多选下拉(A/B/C/D,默认 B)。一键出品 和 图库「二创」共用这一个,避免重复实现。
// 自带 trigger 按钮 + 弹层 + 选择态;点「开始」回调选中的方向。

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { REMIX_DIRECTIONS } from '@/lib/etsy-forge/remix-axes';

export function RemixDirectionMenu({
  triggerLabel,
  confirmLabel,
  disabled,
  busy,
  variant = 'default',
  title,
  onConfirm,
}: {
  triggerLabel: string; // 触发按钮文案前缀,如「一键出品」「二创」
  confirmLabel: string; // 弹层主按钮文案,如「开始一键出品」「开始二创」
  disabled?: boolean;
  busy?: boolean;
  variant?: 'default' | 'outline'; // 触发按钮样式
  title?: string; // 触发按钮 hover 提示
  onConfirm: (directions: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dirs, setDirs] = useState<Set<string>>(new Set(['B'])); // 默认方向 B

  const toggle = (k: string) =>
    setDirs((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="relative">
      <Button size="sm" variant={variant} title={title} disabled={disabled || busy} onClick={() => setOpen((v) => !v)}>
        {busy ? '启动中…' : `${triggerLabel}（${dirs.size} 方向）`} ▾
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
            <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">选二创方向(可多选,默认 B)</p>
            {REMIX_DIRECTIONS.map((d) => (
              <label key={d.key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted">
                <input type="checkbox" checked={dirs.has(d.key)} onChange={() => toggle(d.key)} className="mt-0.5 size-3.5 shrink-0 accent-foreground" />
                <span className="text-xs leading-tight">
                  {d.key} · {d.label}
                  <span className="ml-1 text-[10px] text-muted-foreground">{d.desc}</span>
                </span>
              </label>
            ))}
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={dirs.size === 0}
              onClick={() => {
                onConfirm([...dirs]);
                setOpen(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
