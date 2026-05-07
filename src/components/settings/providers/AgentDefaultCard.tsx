'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { getProviderModelCatalogMeta } from '@/lib/model-metadata';
import { matchesCapabilityFilter, type SavedConfig } from './shared';

const PROVIDER_KEY = 'agent_default_provider_id';
const MODEL_KEY = 'agent_default_model';

/**
 * "Workflow Agent 默认" — pins a (provider, model) pair that workflow agent
 * steps fall back to when neither the agent preset nor the source chat
 * session specified anything.
 *
 * Why it lives here instead of in workflow settings: agents share the chat
 * provider catalog, so configuring it next to the AI 对话 list makes the
 * inheritance obvious. The pinned pair takes precedence over the user's
 * active chat picker so cron-triggered runs don't drift with the picker.
 */
export function AgentDefaultCard() {
  const [providers, setProviders] = useState<SavedConfig[]>([]);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [provRes, settingsRes] = await Promise.all([
        fetch('/api/providers'),
        fetch('/api/settings/app'),
      ]);
      if (!provRes.ok) throw new Error('加载服务商列表失败');
      if (!settingsRes.ok) throw new Error('加载设置失败');
      const provData = await provRes.json();
      const settingsData = await settingsRes.json();
      const allProviders: SavedConfig[] = provData.providers || [];
      const chatProviders = allProviders.filter((p) => matchesCapabilityFilter(p, 'agent-chat'));
      setProviders(chatProviders);
      setProviderId(settingsData.settings?.[PROVIDER_KEY] || '');
      setModel(settingsData.settings?.[MODEL_KEY] || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const handler = () => { void load(); };
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [load]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );

  const modelOptions = useMemo(
    () => (selectedProvider ? getProviderModelCatalogMeta(selectedProvider).models : []),
    [selectedProvider],
  );

  const persist = useCallback(async (nextProviderId: string, nextModel: string) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/settings/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            [PROVIDER_KEY]: nextProviderId,
            [MODEL_KEY]: nextModel,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || '保存失败');
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, []);

  // Switching the provider clears the model — the previous model rarely lives
  // in the new provider's catalog. User picks again from the new options.
  const handleProviderChange = (next: string) => {
    setProviderId(next);
    setModel('');
    void persist(next, '');
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    void persist(providerId, next);
  };

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Workflow Agent 默认</CardTitle>
        <p className="text-sm text-muted-foreground">
          指定工作流 agent 步骤在没有显式选择时使用的服务商和模型。覆盖右上角对话服务商，专门给 cron / 自动触发的 workflow 用。
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="py-6 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">服务商</label>
                <select
                  value={providerId}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  disabled={saving}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                >
                  <option value="">未指定（沿用聊天服务商）</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">模型</label>
                <select
                  value={model}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={saving || !providerId || modelOptions.length === 0}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                >
                  <option value="">
                    {providerId ? '未指定（沿用服务商默认模型）' : '请先选服务商'}
                  </option>
                  {modelOptions.map((m) => (
                    <option key={m.value} value={m.value}>{m.label || m.value}</option>
                  ))}
                </select>
              </div>
            </div>
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            {saving && (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> 保存中…
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
