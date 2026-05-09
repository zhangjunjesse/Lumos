'use client';

import * as React from 'react';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { StylePreset } from './types';

export function PresetsTab({
  presets,
  onChanged,
}: {
  presets: StylePreset[];
  onChanged: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">风格预设</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted-foreground">
            内置 catalog / lifestyle / campaign 三个方向是 SOP 默认基线；可新增自定义预设来固化你常用的场景。
          </p>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {presets.map((preset) => (
              <PresetCard key={preset.id} preset={preset} onChanged={onChanged} />
            ))}
            {presets.length === 0 ? (
              <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                还没有预设。重启或刷新会自动写入内置预设；也可以点击「新增预设」创建自定义预设。
              </p>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function PresetCard({
  preset,
  onChanged,
}: {
  preset: StylePreset;
  onChanged: () => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const toggleEnabled = async () => {
    setBusy(true);
    try {
      await fetch(`/api/apps/builtin/ecommerce/presets/${preset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !preset.enabled }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-col gap-2 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="truncate text-sm font-medium">{preset.name}</h4>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          {preset.direction}
        </span>
      </div>
      {preset.scene ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{preset.scene}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {preset.is_builtin ? <span>内置</span> : <span>自定义</span>}
        <span>{preset.enabled ? '启用' : '禁用'}</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={toggleEnabled} disabled={busy}>
          <Pencil className="size-3.5" />
          {preset.enabled ? '禁用' : '启用'}
        </Button>
      </div>
    </li>
  );
}
