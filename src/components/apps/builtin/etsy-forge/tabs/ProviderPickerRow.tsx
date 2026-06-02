'use client';

// 设置里「服务商 + 模型」选择块(评论分析 / 识图共用):选服务商→自动带出首个模型→可换模型。纯展示,状态在 SettingsTab。

import { type ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AiProviderOption } from '../api-client';

export function ProviderPickerRow({
  title,
  desc,
  providers,
  providerId,
  model,
  defaultLabel,
  msg,
  footer,
  onPick,
  onModelChange,
}: {
  title: string;
  desc: ReactNode;
  providers: AiProviderOption[];
  providerId: string;
  model: string;
  defaultLabel: string; // 「不选服务商」那项的文案
  msg: { ok: boolean; text: string } | null;
  footer?: ReactNode;
  onPick: (providerId: string) => void;
  onModelChange: (model: string) => void;
}) {
  const models = providers.find((p) => p.id === providerId)?.models ?? [];
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-1 text-sm font-medium">{title}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{desc}</p>
      <div className="flex flex-wrap gap-2">
        <Select value={providerId || '__default__'} onValueChange={(v) => onPick(v === '__default__' ? '' : v)}>
          <SelectTrigger className="h-9 w-56 text-sm">
            <SelectValue placeholder="选服务商" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">{defaultLabel}</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? '（全局默认）' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {providerId && (
          <Select value={model} onValueChange={onModelChange}>
            <SelectTrigger className="h-9 w-48 text-sm">
              <SelectValue placeholder="选模型" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>{msg.text}</p>}
      {footer}
    </section>
  );
}
