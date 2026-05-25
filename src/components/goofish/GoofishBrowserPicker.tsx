'use client';

import * as React from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BrowserProviderConfigView, BrowserProvidersResponse } from '@/types';

const DEFAULT_CONTEXT_ID = 'embedded:default';

interface Option {
  id: string;
  label: string;
  description: string;
  disabled?: boolean;
}

export function GoofishBrowserPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (contextId: string) => void;
  disabled?: boolean;
}): React.ReactElement {
  const [options, setOptions] = React.useState<Option[]>([defaultOption()]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/browser-providers', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as BrowserProvidersResponse;
        if (!alive) return;
        const next: Option[] = [defaultOption()];
        for (const c of json.configs ?? []) {
          next.push(toOption(c));
        }
        setOptions(next);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const selected = options.find((o) => o.id === value) ?? options[0];

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">浏览器</label>
      <Select
        value={selected?.id ?? DEFAULT_CONTEXT_ID}
        onValueChange={onChange}
        disabled={disabled || loading}
      >
        <SelectTrigger className="h-9 w-full text-sm">
          <SelectValue placeholder="选择浏览器" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id} disabled={o.disabled}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="truncate" title={selected?.description}>{selected?.description}</span>
        <a
          href="/settings"
          className="inline-flex shrink-0 items-center gap-0.5 text-primary hover:underline"
        >
          管理浏览器 <ExternalLink className="size-2.5" />
        </a>
      </div>
      {loading ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : null}
    </div>
  );
}

function defaultOption(): Option {
  return {
    id: DEFAULT_CONTEXT_ID,
    label: '内置浏览器（推荐）',
    description: 'Lumos 自带浏览器，扫码登录后会自动保存账号',
  };
}

function toOption(c: BrowserProviderConfigView): Option {
  const prefix = c.provider_type === 'adspower' ? 'AdsPower' : 'CDP';
  return {
    id: c.context_id,
    label: `${prefix} · ${c.display_name}`,
    description: c.provider_type === 'adspower'
      ? `Profile: ${c.profile_id || '未绑定'}`
      : c.cdp_endpoint || '未填写 CDP 地址',
    disabled: c.enabled !== 1,
  };
}
