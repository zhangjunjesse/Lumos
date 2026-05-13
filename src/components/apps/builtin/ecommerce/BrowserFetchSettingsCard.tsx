'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Settings2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { browserConfigLabel, browserContextFallbackLabel } from '@/lib/browser-provider/labels';
import type { BrowserProviderConfigView, BrowserProvidersResponse } from '@/types';

interface BrowserFetchStatus {
  enabled: boolean;
  browserContextId: string;
  browserLabel?: string;
}

interface BrowserOption {
  id: string;
  label: string;
  description: string;
  disabled?: boolean;
}

function describeConfig(config: BrowserProviderConfigView): string {
  if (config.provider_type === 'adspower') {
    return `Profile: ${config.profile_name || config.profile_id || '未填写'}`;
  }
  return config.cdp_endpoint || '未填写 CDP 地址';
}

function buildOptions(configs: BrowserProviderConfigView[], selectedId: string): BrowserOption[] {
  const options: BrowserOption[] = [{
    id: 'embedded:default',
    label: '内置浏览器',
    description: '后台抓取，不会弹出 AdsPower 外部窗口；适合本机 TUN / VPN 已经生效的场景',
  }];
  for (const config of configs) {
    options.push({
      id: config.context_id,
      label: browserConfigLabel(config),
      description: config.provider_type === 'adspower'
        ? `${describeConfig(config)}；AdsPower 会启动外部 Profile 窗口，当前不支持真正无头启动`
        : describeConfig(config),
      disabled: config.enabled !== 1,
    });
  }
  if (selectedId && !options.some((option) => option.id === selectedId)) {
    options.push({
      id: selectedId,
      label: browserContextFallbackLabel(selectedId),
      description: '这个浏览器上下文已保存，但当前浏览器设置列表里没有找到。',
      disabled: true,
    });
  }
  return options;
}

export function BrowserFetchSettingsCard(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [status, setStatus] = React.useState<BrowserFetchStatus | null>(null);
  const [configs, setConfigs] = React.useState<BrowserProviderConfigView[]>([]);
  const [form, setForm] = React.useState({
    enabled: true,
    browserContextId: 'embedded:default',
  });
  const [testResult, setTestResult] = React.useState<
    | { ok: true; htmlLength: number; elapsedMs: number; warning?: string; browserLabel?: string }
    | { ok: false; reason: string }
    | null
  >(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, providersRes] = await Promise.all([
        fetch('/api/apps/builtin/ecommerce/settings/browser-fetch', { cache: 'no-store' }),
        fetch('/api/browser-providers', { cache: 'no-store' }),
      ]);
      if (providersRes.ok) {
        const payload = (await providersRes.json()) as BrowserProvidersResponse;
        setConfigs(payload.configs ?? []);
      }
      if (settingsRes.ok) {
        const json = (await settingsRes.json()) as BrowserFetchStatus;
        setStatus(json);
        setForm({
          enabled: json.enabled,
          browserContextId: json.browserContextId || 'embedded:default',
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/settings/browser-fetch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: form.enabled,
          browserContextId: form.browserContextId,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as BrowserFetchStatus;
        setStatus(json);
      }
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/settings/browser-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_url: 'https://www.amazon.com/s?k=mug',
          enabled: form.enabled,
          browserContextId: form.browserContextId,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setTestResult({
          ok: true,
          htmlLength: json.html_length,
          elapsedMs: json.elapsed_ms,
          browserLabel: json.browser_label,
          warning: json.warning,
        });
      } else {
        setTestResult({ ok: false, reason: json.reason ?? '未知错误' });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const options = React.useMemo(
    () => buildOptions(configs, form.browserContextId),
    [configs, form.browserContextId],
  );
  const selected = options.find((option) => option.id === form.browserContextId) ?? options[0];
  const selectedDisabled = Boolean(selected?.disabled);
  const collapsedStatus = status?.enabled
    ? `已启用 · ${status.browserLabel || browserContextFallbackLabel(status.browserContextId)}`
    : `未启用（仅用 server fetch，反爬概率高）`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Settings2 className="size-4" /> 浏览器抓取 / 反爬
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`text-[11px] ${
                status?.enabled ? 'text-emerald-600' : 'text-muted-foreground'
              }`}
            >
              {loading ? '加载中…' : collapsedStatus}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
              {open ? '收起' : '配置'}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-3">
          <p className="rounded-md bg-foreground/5 p-2 text-[11px] text-foreground/80">
            启用后选品研究的 Amazon / Etsy / Walmart / TikTok Shop 抓取会直接复用
            Lumos「浏览器」设置里的内置浏览器、AdsPower 或 CDP 上下文。这里不再保存
            AdsPower API 地址、Profile 或 Key。
          </p>
          {form.browserContextId.startsWith('adspower:') ? (
            <Alert>
              <AlertCircle className="size-4" />
              <AlertDescription className="text-xs">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    AdsPower 的本地 API 会启动它自己的外部浏览器窗口；Lumos 只能让标签页后台操作并自动关闭，
                    不能把 AdsPower Profile 变成真正无头。若本机 TUN / VPN 已覆盖访问，请切到“内置浏览器”。
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setForm((f) => ({ ...f, browserContextId: 'embedded:default' }))}
                  >
                    改用内置浏览器
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          <div>
            <Label htmlFor="ecommerce-browser-context" className="text-xs">
              抓取浏览器
            </Label>
            <div className="mt-1 flex gap-2">
              <select
                id="ecommerce-browser-context"
                value={form.browserContextId}
                onChange={(e) => setForm((f) => ({ ...f, browserContextId: e.target.value }))}
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                disabled={saving || testing || loading}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id} disabled={option.disabled}>
                    {option.label}{option.disabled ? '（不可用）' : ''}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={loading} onClick={load}>
                {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                刷新
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {selected?.description || '使用 Lumos 当前浏览器上下文'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="ads-power-enabled"
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="size-4 cursor-pointer"
            />
            <label htmlFor="ads-power-enabled" className="text-xs">
              优先用浏览器抓取；失败时再退回 server fetch
            </label>
          </div>
          {selectedDisabled ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription className="text-xs">
                当前保存的浏览器上下文不可用。请在 Lumos 设置的「浏览器」里启用它，或切换到其它可用上下文。
              </AlertDescription>
            </Alert>
          ) : null}
          {testResult ? (
            <Alert variant={testResult.ok ? 'default' : 'destructive'}>
              {testResult.ok ? (
                <CheckCircle2 className="size-4 text-emerald-600" />
              ) : (
                <AlertCircle />
              )}
              <AlertDescription className="text-xs">
                {testResult.ok ? (
                  <>
                    抓取成功：{testResult.browserLabel ? `${testResult.browserLabel} · ` : ''}
                    HTML {testResult.htmlLength} 字节，
                    {Math.round(testResult.elapsedMs / 100) / 10}s）
                    {testResult.warning ? `；${testResult.warning}` : ''}
                  </>
                ) : (
                  <>失败：{testResult.reason}</>
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={testing || saving || selectedDisabled}
              onClick={test}
            >
              {testing ? <Loader2 className="size-3 animate-spin" /> : null}
              浏览器抓 amazon.com 测试
            </Button>
            <Button size="sm" disabled={saving} onClick={save}>
              {saving ? <Loader2 className="size-3 animate-spin" /> : null}
              保存
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
