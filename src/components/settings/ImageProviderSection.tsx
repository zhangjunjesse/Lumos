'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  ProviderEditDialog,
  type ProviderEditTarget,
} from './ProviderEditDialog';
import { ImageProviderDetail } from './ImageProviderDetail';
import {
  IMAGE_MODULE_CONFIG,
  VIDEO_MODULE_CONFIG,
  PLACEHOLDER_VALUE,
  providerEligibleForModule,
  parseModelCatalog,
  type ModuleConfig,
  type ProviderOption,
} from './module-override-config';

interface ImageProviderSectionProps {
  /** When true, hide add/edit/delete controls and restrict the provider
   *  dropdown to `provider_origin='system'` rows. User can still switch
   *  between admin-provisioned providers. */
  readOnly?: boolean;
  config?: ModuleConfig;
}

/**
 * Dedicated section for the image generation module. Split from
 * ModuleOverrideSection because its management surface (edit / delete the
 * bound image provider) is unique to this category and it is gated by the
 * `media` custom-provider flag independently of the text modules.
 */
export function ImageProviderSection({
  readOnly = false,
  config = IMAGE_MODULE_CONFIG,
}: ImageProviderSectionProps = {}) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const [editTarget, setEditTarget] = useState<ProviderEditTarget | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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
          provider_origin: p.provider_origin || 'custom',
          model_catalog: p.model_catalog || '[]',
        })),
      );

      const settings = settingsData.settings || {};
      setProviderId(settings[config.key] || '');
      setModelId(settings[config.modelKey] || '');
      setError('');
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : '读取设置失败');
    } finally {
      setLoading(false);
    }
  }, [config.key, config.modelKey]);

  useEffect(() => {
    void fetchData();
    const handler = () => { void fetchData(); };
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchData]);

  const saveSetting = useCallback(async (key: string, value: string) => {
    setSaving(key);
    setError('');
    try {
      const res = await fetch('/api/settings/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [key]: value } }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || '保存设置失败');
      window.dispatchEvent(new Event('provider-changed'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存设置失败');
      throw saveError;
    } finally {
      setSaving((current) => (current === key ? null : current));
    }
  }, []);

  const handleProviderChange = useCallback(async (value: string) => {
    const resolved = value === PLACEHOLDER_VALUE ? '' : value;
    const prevProvider = providerId;
    const prevModel = modelId;
    setProviderId(resolved);
    setModelId('');
    try {
      await saveSetting(config.key, resolved);
      await saveSetting(config.modelKey, '');
    } catch {
      setProviderId(prevProvider);
      setModelId(prevModel);
    }
  }, [providerId, modelId, saveSetting, config.key, config.modelKey]);

  const handleModelChange = useCallback(async (value: string) => {
    const resolved = value === PLACEHOLDER_VALUE ? '' : value;
    const prev = modelId;
    setModelId(resolved);
    try {
      await saveSetting(config.modelKey, resolved);
    } catch {
      setModelId(prev);
    }
  }, [modelId, saveSetting, config.modelKey]);

  const openEditDialog = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/providers/${id}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({})) as { provider?: ProviderEditTarget; error?: string };
      if (!res.ok || !data.provider) return;
      setEditTarget(data.provider);
      setEditOpen(true);
    } catch { /* ignore */ }
  }, []);

  const handleEditSaved = useCallback(async () => {
    await fetchData();
    window.dispatchEvent(new Event('provider-changed'));
  }, [fetchData]);

  const handleDeleteProvider = useCallback(async () => {
    if (!deleteTargetId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      // Clear override first so deletion isn't blocked by reference
      const clearRes = await fetch('/api/settings/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [config.key]: '', [config.modelKey]: '' } }),
      });
      if (!clearRes.ok) throw new Error('清除引用失败');

      const res = await fetch(`/api/providers/${deleteTargetId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setDeleteError(data.error || '删除失败');
        return;
      }
      setDeleteTargetId(null);
      setProviderId('');
      setModelId('');
      await fetchData();
      window.dispatchEvent(new Event('provider-changed'));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }, [deleteTargetId, fetchData, config.key, config.modelKey]);

  const handleCreated = useCallback(async (provider: ApiProvider) => {
    await fetchData();
    window.dispatchEvent(new Event('provider-changed'));
    setCreateOpen(false);
    await saveSetting(config.key, provider.id);
    setProviderId(provider.id);
  }, [fetchData, saveSetting, config.key]);

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const eligible = providers.filter(
    (p) => providerEligibleForModule(p, config) && (!readOnly || p.provider_origin === 'system'),
  );
  const currentProvider = providerId ? providerMap.get(providerId) || null : null;
  const currentValid = !providerId || eligible.some((p) => p.id === providerId);
  const models = currentProvider ? parseModelCatalog(currentProvider.model_catalog) : [];

  return (
    <>
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base font-semibold">{config.label}</CardTitle>
            {(saving === config.key || saving === config.modelKey) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">{config.description}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <p className="text-xs text-muted-foreground">
              {currentProvider ? `当前：${currentProvider.name}` : config.emptyValueLabel}
              {modelId ? ` / ${modelId}` : ''}
            </p>

            <div className="flex w-full flex-col gap-2 lg:w-[280px]">
              <Select
                value={providerId || PLACEHOLDER_VALUE}
                onValueChange={(v) => { void handleProviderChange(v); }}
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
                  value={modelId || PLACEHOLDER_VALUE}
                  onValueChange={(v) => { void handleModelChange(v); }}
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
              {!readOnly && (
                <Button
                  variant="outline" size="sm"
                  className="w-full justify-center gap-1.5 text-xs"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加服务
                </Button>
              )}
            </div>
          </div>

          {!currentValid && providerId && (
            <p className="text-xs text-destructive">之前选择的服务已不可用，请重新选择。</p>
          )}
          {eligible.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {readOnly ? `管理员尚未配置${config.label}服务。` : `还没有可用的服务。${config.emptyHint}`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{config.emptyHint}</p>
          )}

          {currentProvider && currentValid && (
            <ImageProviderDetail
              provider={currentProvider}
              readOnly={readOnly}
              priceKind={config.capability === 'video-gen' ? 'second' : 'image'}
              onEdit={() => { void openEditDialog(currentProvider.id); }}
              onDelete={() => {
                setDeleteTargetId(currentProvider.id);
                setDeleteTargetName(currentProvider.name);
                setDeleteError('');
              }}
            />
          )}
        </CardContent>
      </Card>

      <AddProviderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        requiredCapability={config.capability}
        targetModule={config.moduleKey}
        title={config.createTitle}
        description="创建后自动应用到当前功能，你也可以稍后再修改。"
        onCreated={handleCreated}
      />

      <ProviderEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        provider={editTarget}
        onSaved={handleEditSaved}
      />

      <AlertDialog
        open={!!deleteTargetId}
        onOpenChange={(open) => { if (!open) { setDeleteTargetId(null); setDeleteError(''); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 <strong>{deleteTargetName}</strong> 吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-xs font-medium text-destructive">删除失败</p>
              <p className="mt-0.5 text-xs text-destructive/80">{deleteError}</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProvider}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function VideoProviderSection({ readOnly = false }: Pick<ImageProviderSectionProps, 'readOnly'> = {}) {
  return <ImageProviderSection readOnly={readOnly} config={VIDEO_MODULE_CONFIG} />;
}
