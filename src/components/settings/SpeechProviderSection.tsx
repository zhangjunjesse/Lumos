'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ApiProvider } from '@/types';

import { SPEECH_MODULE_CONFIG, PLACEHOLDER_VALUE } from './module-override-config';

interface SpeechProviderSectionProps {
  /** Reserved for parity with ImageProviderSection; speech is always cloud-only,
   *  so this value is currently ignored — there's no "add custom" path. */
  readOnly?: boolean;
}

interface SpeechProviderRow {
  id: string;
  name: string;
  provider_type: string;
  notes: string;
  extra_env: string;
}

interface SpeechExtraEnv {
  LUMOS_SPEECH_PRICE_PER_SECOND?: string;
  LUMOS_SPEECH_RESOURCE_ID?: string;
  LUMOS_DEFAULT_MODEL?: string;
}

function parseExtraEnv(extraEnv: string): SpeechExtraEnv {
  if (!extraEnv) return {};
  try {
    const parsed = JSON.parse(extraEnv);
    return parsed && typeof parsed === 'object' ? (parsed as SpeechExtraEnv) : {};
  } catch {
    return {};
  }
}

function formatPricePerMinute(extraEnv: SpeechExtraEnv): string | null {
  const raw = extraEnv.LUMOS_SPEECH_PRICE_PER_SECOND;
  const perSecond = typeof raw === 'string' ? Number.parseFloat(raw) : NaN;
  if (!Number.isFinite(perSecond)) return null;
  const perMinute = perSecond * 60;
  return `${perMinute.toFixed(4)} 元/分钟`;
}

export function SpeechProviderSection(_props: SpeechProviderSectionProps) {
  const [providers, setProviders] = useState<SpeechProviderRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [provRes, settingsRes] = await Promise.all([
        fetch('/api/providers', { cache: 'no-store' }),
        fetch('/api/settings/app', { cache: 'no-store' }),
      ]);
      const provJson = (await provRes.json().catch(() => ({}))) as { providers?: ApiProvider[] };
      const settingsJson = (await settingsRes.json().catch(() => ({}))) as { settings?: Record<string, string> };
      const list = (provJson.providers ?? [])
        .filter((p) => {
          if (p.provider_origin !== 'system') return false;
          try {
            const caps = JSON.parse(p.capabilities ?? '[]');
            return Array.isArray(caps) && caps.includes('speech');
          } catch {
            return false;
          }
        })
        .map((p) => ({
          id: p.id,
          name: p.name,
          provider_type: p.provider_type,
          notes: p.notes ?? '',
          extra_env: p.extra_env ?? '',
        }));
      setProviders(list);
      const settings = settingsJson.settings ?? {};
      const override = settings[SPEECH_MODULE_CONFIG.key] ?? '';
      setSelectedId(override || (list.length === 1 ? list[0].id : ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载语音服务商失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSelect = useCallback(async (next: string) => {
    const value = next === PLACEHOLDER_VALUE ? '' : next;
    setSaving(true);
    setError(null);
    setSelectedId(value);
    try {
      const res = await fetch('/api/settings/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [SPEECH_MODULE_CONFIG.key]: value } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? '保存失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedId) ?? null,
    [providers, selectedId],
  );
  const selectedExtra = useMemo(
    () => (selectedProvider ? parseExtraEnv(selectedProvider.extra_env) : {}),
    [selectedProvider],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Volume2 className="size-4 text-muted-foreground" />
          {SPEECH_MODULE_CONFIG.label}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{SPEECH_MODULE_CONFIG.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            加载中…
          </div>
        ) : providers.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            云端尚未下发任何语音服务商。请确认登录的 Lumos 账号已被管理员开通语音能力。
          </div>
        ) : (
          <>
            <Select value={selectedId || PLACEHOLDER_VALUE} onValueChange={onSelect} disabled={saving}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={SPEECH_MODULE_CONFIG.emptyValueLabel} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PLACEHOLDER_VALUE}>{SPEECH_MODULE_CONFIG.emptyValueLabel}</SelectItem>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedProvider ? (
              <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Row label="服务商类型" value={selectedProvider.provider_type} />
                <Row label="价格" value={formatPricePerMinute(selectedExtra) ?? '价格未下发'} />
                {selectedExtra.LUMOS_DEFAULT_MODEL ? (
                  <Row label="模型" value={selectedExtra.LUMOS_DEFAULT_MODEL} />
                ) : null}
                {selectedExtra.LUMOS_SPEECH_RESOURCE_ID ? (
                  <Row label="资源 ID" value={selectedExtra.LUMOS_SPEECH_RESOURCE_ID} />
                ) : null}
                <p className="pt-1 text-[11px] leading-relaxed">
                  所有调用通过 Lumos 云端代理，密钥由后台统一管理；按音频时长自动从 new-api 余额扣费。
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{SPEECH_MODULE_CONFIG.emptyHint}</p>
            )}

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
