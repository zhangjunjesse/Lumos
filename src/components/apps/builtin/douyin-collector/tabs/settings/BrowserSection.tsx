'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  EMBEDDED_BROWSER_CONTEXT_ID,
  browserConfigLabel,
  browserContextFallbackLabel,
} from '@/lib/browser-provider/labels';
import type {
  BrowserProviderConfigView,
  BrowserProvidersResponse,
} from '@/types';

import type { useCollectorSettings } from '../../use-collector-settings';
import { Section } from './Section';

type SaveFn = ReturnType<typeof useCollectorSettings>['save'];
type ClientSettings = NonNullable<ReturnType<typeof useCollectorSettings>['settings']>;

interface BrowserOption {
  id: string;
  label: string;
  description: string;
  disabled: boolean;
}

function describeConfig(config: BrowserProviderConfigView): string {
  if (config.provider_type === 'adspower') {
    return `Profile: ${config.profile_name || config.profile_id || '未填写'}；AdsPower 会启动它自己的外部 Profile 窗口，不支持真正无头`;
  }
  return config.cdp_endpoint || '未填写 CDP 地址';
}

function buildOptions(
  configs: BrowserProviderConfigView[],
  selectedId: string,
  localChrome?: BrowserProvidersResponse['local_chrome_context'],
): BrowserOption[] {
  const options: BrowserOption[] = [{
    id: EMBEDDED_BROWSER_CONTEXT_ID,
    label: '内置浏览器',
    description: '后台抓取，不弹外部窗口；无真实登录态，抖音风控概率高',
    disabled: false,
  }];
  if (localChrome) {
    options.push({
      id: localChrome.id,
      label: localChrome.display_name,
      description: '用你电脑上的 Chrome，真实登录态，抖音风控概率低',
      disabled: false,
    });
  }
  for (const config of configs) {
    options.push({
      id: config.context_id,
      label: browserConfigLabel(config),
      description: describeConfig(config),
      disabled: config.enabled !== 1,
    });
  }
  if (selectedId && !options.some((o) => o.id === selectedId)) {
    options.push({
      id: selectedId,
      label: browserContextFallbackLabel(selectedId),
      description: '该上下文已保存，但当前「设置 → 浏览器」列表里找不到——已禁用或被删除。',
      disabled: true,
    });
  }
  return options;
}

export function BrowserSection({
  settings,
  save,
}: {
  settings: ClientSettings;
  save: SaveFn;
}): React.ReactElement {
  const [configs, setConfigs] = React.useState<BrowserProviderConfigView[]>([]);
  const [localChrome, setLocalChrome] = React.useState<BrowserProvidersResponse['local_chrome_context']>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveErr, setSaveErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/browser-providers', { cache: 'no-store' });
      if (res.ok) {
        const payload = (await res.json()) as BrowserProvidersResponse;
        setConfigs(payload.configs ?? []);
        setLocalChrome(payload.local_chrome_context ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const selectedId = settings.browserContextId || EMBEDDED_BROWSER_CONTEXT_ID;
  const options = React.useMemo(
    () => buildOptions(configs, selectedId, localChrome),
    [configs, selectedId, localChrome],
  );
  const selected = options.find((o) => o.id === selectedId) ?? options[0];

  async function onChange(nextId: string) {
    if (nextId === selectedId) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await save({ browserContextId: nextId });
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="采集浏览器"
      description="博主 / 关键词采集必须用真浏览器跑完抖音反爬 JS-VM。这里显式指定用哪个上下文——只用选定的，采集失败时报错直接指向它，不会偷偷换浏览器。单视频「按链接采集」走纯 HTTP，不受此项影响。"
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="douyin-browser-context"
            className="text-xs text-muted-foreground"
          >
            上下文（复用 Lumos「设置 → 浏览器」里配置的内置 / AdsPower / CDP）
          </label>
          <select
            id="douyin-browser-context"
            value={selectedId}
            onChange={(e) => void onChange(e.target.value)}
            disabled={saving || loading}
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            {options.map((option) => (
              <option key={option.id} value={option.id} disabled={option.disabled}>
                {option.label}{option.disabled ? '（不可用）' : ''}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          刷新
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {selected?.description ?? '使用当前浏览器上下文'}
      </p>

      {selected?.disabled ? (
        <p className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3.5" />
          当前选中的上下文不可用——去「设置 → 浏览器」启用它，或在上面改选一个可用的。
        </p>
      ) : null}

      {selectedId.startsWith('adspower:') ? (
        <p className="text-[11px] text-muted-foreground">
          用 AdsPower 时，请确认 AdsPower 客户端已启动且该 Profile 能正常打开抖音、已登录；
          如果采集遇到验证码，Lumos 会保留并切到该验证页，人工通过后再点「立即采集」。
        </p>
      ) : null}

      {saveErr ? <p className="text-xs text-rose-500">{saveErr}</p> : null}
    </Section>
  );
}
