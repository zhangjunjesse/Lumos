'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { browserConfigLabel, browserContextFallbackLabel, EMBEDDED_BROWSER_CONTEXT_ID } from '@/lib/browser-provider/labels';
import type { BrowserProviderConfigView, BrowserProvidersResponse } from '@/types';

import { api } from './api';
import type { SettingsDto } from './types';

export function SettingsTab({ active }: { active: boolean }): React.ReactElement {
  const [form, setForm] = React.useState<SettingsDto | null>(null);
  const [configs, setConfigs] = React.useState<BrowserProviderConfigView[]>([]);
  const [localChromeCtx, setLocalChromeCtx] = React.useState<{ id: string; display_name: string } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    if (!active || form) return;
    void (async () => {
      try {
        const [settings, providers] = await Promise.all([
          api.settings(),
          fetch('/api/browser-providers', { cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<BrowserProvidersResponse>) : null))
            .catch(() => null),
        ]);
        setForm(settings.settings);
        setConfigs(providers?.configs ?? []);
        setLocalChromeCtx(providers?.local_chrome_context ?? null);
      } catch (err) {
        setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [active, form]);

  if (!form) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载设置…
      </div>
    );
  }

  const patch = (p: Partial<SettingsDto>) => setForm({ ...form, ...p });

  const contextOptions = buildContextOptions(configs, form.browserContextId, localChromeCtx);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api.saveSettings(form);
      setForm(saved.settings);
      setMessage({ ok: true, text: '已保存' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>站点</Label>
          <Input value={form.site} onChange={(e) => patch({ site: e.target.value })} placeholder="www.amazon.com" />
        </div>
        <div className="space-y-1.5">
          <Label>配送邮编</Label>
          <Input value={form.zipCode} onChange={(e) => patch({ zipCode: e.target.value })} placeholder="10001" />
          <p className="text-xs text-muted-foreground">排名随配送地变化，固定邮编结果才可比。</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>查询用浏览器</Label>
          <Select value={form.browserContextId} onValueChange={(v) => patch({ browserContextId: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {contextOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">在「设置 → 浏览器」里管理 AdsPower / 外部浏览器。</p>
        </div>
        <div className="space-y-1.5">
          <Label>无痕模式</Label>
          <div className="flex h-9 items-center gap-2">
            <Switch checked={form.incognito} onCheckedChange={(v) => patch({ incognito: v })} />
            <span className="text-sm text-muted-foreground">避免登录态影响排名个性化</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>每词最小间隔（秒）</Label>
          <Input
            type="number" min={1} max={60}
            value={Math.round(form.delayMinMs / 1000)}
            onChange={(e) => patch({ delayMinMs: clampNumber(e.target.value, 1, 60) * 1000 })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>每词最大间隔（秒）</Label>
          <Input
            type="number" min={1} max={120}
            value={Math.round(form.delayMaxMs / 1000)}
            onChange={(e) => patch({ delayMaxMs: clampNumber(e.target.value, 1, 120) * 1000 })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>单次词数上限</Label>
          <Input
            type="number" min={1} max={200}
            value={form.maxKeywords}
            onChange={(e) => patch({ maxKeywords: clampNumber(e.target.value, 1, 200) })}
          />
          <p className="text-xs text-muted-foreground">调高更容易触发亚马逊风控。</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>查询说明</Label>
        <Textarea rows={3} value={form.aiSystemPrompt} onChange={(e) => patch({ aiSystemPrompt: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>风险边界</Label>
        <Textarea rows={3} value={form.riskNote} onChange={(e) => patch({ riskNote: e.target.value })} />
      </div>

      {message ? (
        <Alert variant={message.ok ? 'default' : 'destructive'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      <Button onClick={() => void save()} disabled={saving}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
        保存设置
      </Button>
    </div>
  );
}

function buildContextOptions(
  configs: BrowserProviderConfigView[],
  current: string,
  localChrome?: { id: string; display_name: string } | null,
): Array<{ value: string; label: string }> {
  const options = new Map<string, string>();
  options.set(EMBEDDED_BROWSER_CONTEXT_ID, '内置浏览器（默认）');
  if (localChrome) {
    options.set(localChrome.id, localChrome.display_name);
  }
  for (const config of configs) {
    if (!config.enabled || !config.context_id) continue;
    options.set(config.context_id, browserConfigLabel(config));
  }
  if (current && !options.has(current)) {
    options.set(current, browserContextFallbackLabel(current));
  }
  return Array.from(options, ([value, label]) => ({ value, label }));
}

function clampNumber(raw: string, min: number, max: number): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}
