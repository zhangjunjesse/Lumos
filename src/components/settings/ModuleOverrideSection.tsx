'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ApiProvider } from '@/types';
import { AddProviderDialog } from './AddProviderDialog';
import {
  MODULE_CONFIGS,
  PLACEHOLDER_VALUE,
  getCapabilityBadgeLabel,
  providerEligibleForModule,
  parseModelCatalog,
  type ModuleConfig,
  type ModelOverrideKey,
  type ProviderOption,
} from './module-override-config';

export function ModuleOverrideSection() {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [createTarget, setCreateTarget] = useState<ModuleConfig | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [provRes, settingsRes] = await Promise.all([
        fetch('/api/providers', { cache: 'no-store' }),
        fetch('/api/settings/app', { cache: 'no-store' }),
      ]);

      const provData = await provRes.json().catch(() => ({})) as { providers?: ProviderOption[]; error?: string };
      const settingsData = await settingsRes.json().catch(() => ({})) as {
        settings?: Record<string, string>;
        error?: string;
      };

      if (!provRes.ok) throw new Error(provData.error || '读取服务列表失败');
      if (!settingsRes.ok) throw new Error(settingsData.error || '读取设置失败');

      setProviders(
        (provData.providers || []).map((p) => ({
          id: p.id, name: p.name, capabilities: p.capabilities,
          provider_type: p.provider_type, auth_mode: p.auth_mode,
          model_catalog: p.model_catalog || '[]',
        })),
      );

      const settings = settingsData.settings || {};
      const resolved: Record<string, string> = {};
      for (const config of MODULE_CONFIGS) {
        resolved[config.key] = settings[config.key] || '';
        resolved[config.modelKey] = settings[config.modelKey] || '';
      }
      setOverrides(resolved);
      setError('');
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : '读取设置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const handler = () => { void fetchData(); };
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchData]);

  const handleChange = useCallback(async (settingKey: ModuleConfig['key'] | ModelOverrideKey, value: string) => {
    const resolvedValue = value === PLACEHOLDER_VALUE ? '' : value;
    const previousValue = overrides[settingKey] || '';
    setOverrides((prev) => ({ ...prev, [settingKey]: resolvedValue }));
    setSaving(settingKey);
    setError('');
    try {
      const res = await fetch('/api/settings/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [settingKey]: resolvedValue } }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || '保存设置失败');
      window.dispatchEvent(new Event('provider-changed'));
    } catch (saveError) {
      setOverrides((prev) => ({ ...prev, [settingKey]: previousValue }));
      setError(saveError instanceof Error ? saveError.message : '保存设置失败');
    } finally {
      setSaving((current) => (current === settingKey ? null : current));
    }
  }, [overrides]);

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  const handleProviderChange = useCallback(async (config: ModuleConfig, value: string) => {
    await handleChange(config.key, value);
    await handleChange(config.modelKey, '');
  }, [handleChange]);

  const handleCreatedProvider = useCallback(async (provider: ApiProvider) => {
    const target = createTarget;
    await fetchData();
    window.dispatchEvent(new Event('provider-changed'));
    setCreateTarget(null);
    if (target) await handleChange(target.key, provider.id);
  }, [createTarget, fetchData, handleChange]);

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold">其他 AI 服务</CardTitle>
          <p className="text-sm text-muted-foreground">
            为不同功能选择各自的 AI 服务。不设置则统一使用上方的对话服务。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            {MODULE_CONFIGS.map((config) => {
              const eligible = providers.filter((p) => providerEligibleForModule(p, config));
              const currentId = overrides[config.key] || '';
              const currentProvider = currentId ? providerMap.get(currentId) || null : null;
              const currentValid = !currentId || eligible.some((p) => p.id === currentId);
              const currentModelId = overrides[config.modelKey] || '';
              const models = currentProvider ? parseModelCatalog(currentProvider.model_catalog) : [];

              return (
                <div key={config.key} className="rounded-lg border border-border/60 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{config.label}</p>
                        <Badge variant="secondary" className="text-[10px]">
                          {getCapabilityBadgeLabel(config.capability)}
                        </Badge>
                        {(saving === config.key || saving === config.modelKey) && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{config.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {currentProvider ? `当前：${currentProvider.name}` : config.emptyValueLabel}
                        {currentModelId ? ` / ${currentModelId}` : ''}
                      </p>
                    </div>

                    <div className="flex w-full flex-col gap-2 lg:w-[280px]">
                      <Select
                        value={currentId || PLACEHOLDER_VALUE}
                        onValueChange={(v) => { void handleProviderChange(config, v); }}
                      >
                        <SelectTrigger className="w-full h-9">
                          <SelectValue placeholder={config.emptyValueLabel} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={PLACEHOLDER_VALUE}>{config.emptyValueLabel}</SelectItem>
                          {eligible.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {models.length > 1 && (
                        <Select
                          value={currentModelId || PLACEHOLDER_VALUE}
                          onValueChange={(v) => { void handleChange(config.modelKey, v); }}
                        >
                          <SelectTrigger className="w-full h-9">
                            <SelectValue placeholder="自动（第一个模型）" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={PLACEHOLDER_VALUE}>自动（第一个模型）</SelectItem>
                            {models.map((m) => (
                              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        variant="outline" size="sm"
                        className="w-full justify-center gap-1.5 text-xs"
                        onClick={() => setCreateTarget(config)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        添加服务
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1">
                    {!currentValid && currentId && (
                      <p className="text-xs text-destructive">之前选择的服务已不可用，请重新选择。</p>
                    )}
                    {eligible.length === 0 ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        还没有可用的服务。{config.emptyHint}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{config.emptyHint}</p>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="rounded-lg border border-dashed border-border/60 bg-muted/15 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">文本嵌入</p>
                <Badge variant="outline" className="text-[10px]">内置</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">由 Lumos 内置提供，无需配置。</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <AddProviderDialog
        open={!!createTarget}
        onOpenChange={(open) => { if (!open) setCreateTarget(null); }}
        requiredCapability={createTarget?.capability || null}
        targetModule={createTarget?.moduleKey || null}
        title={createTarget?.createTitle || '添加服务'}
        description="创建后自动应用到当前功能，你也可以稍后再修改。"
        onCreated={handleCreatedProvider}
      />
    </>
  );
}
