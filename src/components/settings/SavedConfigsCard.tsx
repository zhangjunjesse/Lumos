'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Plus,
  Check,
  Trash2,
  Edit2,
  Loader2,
  Eye,
  EyeOff
} from 'lucide-react';
import type { ProviderModelCatalogSource } from '@/types';
import {
  DEFAULT_PROVIDER_MODEL_OPTIONS,
  formatProviderModelCatalogForEditor,
  parseProviderModelCatalog,
  parseProviderModelCatalogEditor,
  serializeProviderModelCatalog,
} from '@/lib/model-metadata';

interface SavedConfig {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  model_catalog: string;
  model_catalog_source: ProviderModelCatalogSource;
  model_catalog_updated_at: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface DetectModelsResponse {
  models: Array<{ value: string; label: string }>;
  base_url: string;
  model_catalog_source: 'detected';
}

export function SavedConfigsCard() {
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [defaultProviderId, setDefaultProviderId] = useState('');

  // Save dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [configName, setConfigName] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentBaseUrl, setCurrentBaseUrl] = useState('');

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SavedConfig | null>(null);
  const [editName, setEditName] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editModelCatalogText, setEditModelCatalogText] = useState('');
  const [editModelCatalogSource, setEditModelCatalogSource] = useState<ProviderModelCatalogSource>('default');
  const [showEditKey, setShowEditKey] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [detectingModels, setDetectingModels] = useState(false);
  const [detectModelsMessage, setDetectModelsMessage] = useState('');
  const [detectModelsError, setDetectModelsError] = useState('');

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<SavedConfig | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const providers = data.providers || [];
      setConfigs(providers);
      setDefaultProviderId(data.default_provider_id || '');
    } catch (error) {
      console.error('Failed to load configs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();

    // Listen for config changes
    const handleConfigChange = () => fetchConfigs();
    window.addEventListener('provider-changed', handleConfigChange);
    return () => window.removeEventListener('provider-changed', handleConfigChange);
  }, [fetchConfigs]);

  const handleSwitch = async (configId: string) => {
    setSwitching(configId);
    try {
      const res = await fetch(`/api/providers/${configId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      });

      if (res.ok) {
        await fetchConfigs();
        window.dispatchEvent(new Event('provider-changed'));
      }
    } catch (error) {
      console.error('Failed to switch config:', error);
    } finally {
      setSwitching(null);
    }
  };

  const handleOpenSaveDialog = () => {
    const active = configs.find((config) => config.id === defaultProviderId)
      || configs.find((config) => config.is_active === 1)
      || null;
    setCurrentBaseUrl(active?.base_url || '');
    setSaveDialogOpen(true);
    setConfigName('');
  };

  const handleSaveConfig = async () => {
    const active = configs.find((config) => config.id === defaultProviderId)
      || configs.find((config) => config.is_active === 1)
      || null;
    if (!configName.trim() || !active) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/providers/${active.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: configName.trim(),
        }),
      });

      if (res.ok) {
        setSaveDialogOpen(false);
        setConfigName('');
        await fetchConfigs();
      }
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEditDialog = (config: SavedConfig) => {
    setEditingConfig(config);
    setEditName(config.name);
    setEditApiKey(config.api_key);
    setEditBaseUrl(config.base_url);
    setEditModelCatalogText(formatProviderModelCatalogForEditor(config.model_catalog));
    setEditModelCatalogSource(config.model_catalog_source);
    setDetectModelsMessage('');
    setDetectModelsError('');
    setShowEditKey(false);
    setEditDialogOpen(true);
  };

  const handleDetectModels = async () => {
    if (!editingConfig) return;

    setDetectingModels(true);
    setDetectModelsMessage('');
    setDetectModelsError('');

    try {
      const res = await fetch(`/api/providers/${editingConfig.id}/models/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: editBaseUrl,
          apiKey: editApiKey,
          providerType: editingConfig.provider_type,
        }),
      });

      const data = await res.json().catch(() => ({})) as Partial<DetectModelsResponse> & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || '探测模型失败');
      }

      const models = Array.isArray(data.models) ? data.models : [];
      const modelCatalog = serializeProviderModelCatalog(models);
      setEditModelCatalogText(formatProviderModelCatalogForEditor(modelCatalog));
      setEditModelCatalogSource('detected');
      setDetectModelsMessage(`已探测到 ${models.length} 个模型`);
    } catch (error) {
      setDetectModelsError(error instanceof Error ? error.message : '探测模型失败');
    } finally {
      setDetectingModels(false);
    }
  };

  const handleUpdateConfig = async () => {
    if (!editingConfig || !editName.trim()) return;

    const modelCatalog = parseProviderModelCatalogEditor(editModelCatalogText);
    setUpdating(true);
    try {
      const res = await fetch(`/api/providers/${editingConfig.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          provider_type: editingConfig.provider_type,
          api_key: editApiKey,
          base_url: editBaseUrl,
          model_catalog: serializeProviderModelCatalog(modelCatalog),
          model_catalog_source: modelCatalog.length > 0
            ? (editModelCatalogSource === 'detected' ? 'detected' : 'manual')
            : 'default',
          notes: '',
        }),
      });

      if (res.ok) {
        setEditDialogOpen(false);
        setEditingConfig(null);
        await fetchConfigs();
        window.dispatchEvent(new Event('provider-changed'));
      }
    } catch (error) {
      console.error('Failed to update config:', error);
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(deleteTarget.id);
    try {
      const res = await fetch(`/api/providers/${deleteTarget.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setDeleteTarget(null);
        await fetchConfigs();
        window.dispatchEvent(new Event('provider-changed'));
      }
    } catch (error) {
      console.error('Failed to delete config:', error);
    } finally {
      setDeleting(null);
    }
  };

  const getTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
    return `${Math.floor(diffDays / 30)} 月前`;
  };

  const activeConfig = configs.find((config) => config.id === defaultProviderId)
    || configs.find((config) => config.is_active === 1);
  const inactiveConfigs = configs.filter((config) => config.id !== activeConfig?.id);
  const editingModelCount = parseProviderModelCatalogEditor(editModelCatalogText).length;

  const getModelCatalogSourceLabel = (source: ProviderModelCatalogSource, usesDefault: boolean) => {
    if (usesDefault || source === 'default') return '内置默认模型';
    if (source === 'detected') return '自动探测模型';
    return '手动维护模型';
  };

  const getModelCatalogMeta = (config: SavedConfig) => {
    const models = parseProviderModelCatalog(config.model_catalog);
    const usesDefault = models.length === 0;
    return {
      count: usesDefault ? DEFAULT_PROVIDER_MODEL_OPTIONS.length : models.length,
      usesDefault,
      sourceLabel: getModelCatalogSourceLabel(config.model_catalog_source, usesDefault),
      updatedAt: config.model_catalog_updated_at,
    };
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium">
                已保存配置
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                快速切换不同的 API 配置
              </p>
            </div>
            {configs.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {configs.length} 个
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Active Config */}
          {activeConfig && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 transition-all">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {(() => {
                    const meta = getModelCatalogMeta(activeConfig);
                    return (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-sm truncate">{activeConfig.name}</p>
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                            当前使用
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {activeConfig.base_url}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {meta.sourceLabel}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {meta.count} 个模型
                          </span>
                          {meta.updatedAt && !meta.usesDefault && (
                            <span className="text-[11px] text-muted-foreground">
                              更新于 {formatDateTime(meta.updatedAt)}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          配置更新于 {getTimeAgo(activeConfig.updated_at)}
                        </p>
                      </>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleOpenEditDialog(activeConfig)}
                  >
                    <Edit2 className="h-3 w-3 mr-1" />
                    编辑
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Inactive Configs */}
          {inactiveConfigs.length > 0 && (
            <div className="space-y-2">
              {inactiveConfigs.map((config) => (
                <div
                  key={config.id}
                  className="group rounded-lg border border-border/50 p-3 transition-all hover:border-border hover:shadow-sm hover:bg-accent/30"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-2 w-2 rounded-full bg-muted-foreground/30 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      {(() => {
                        const meta = getModelCatalogMeta(config);
                        return (
                          <>
                            <p className="font-medium text-sm truncate">{config.name}</p>
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {config.base_url}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <p className="text-[11px] text-muted-foreground">
                                API Key: {config.api_key.slice(0, 12)}••••••
                              </p>
                              <span className="text-[11px] text-muted-foreground">·</span>
                              <Badge variant="secondary" className="text-[10px]">
                                {meta.sourceLabel}
                              </Badge>
                              <span className="text-[11px] text-muted-foreground">
                                {meta.count} 个模型
                              </span>
                              <span className="text-[11px] text-muted-foreground">·</span>
                              <p className="text-[11px] text-muted-foreground">
                                保存于 {getTimeAgo(config.created_at)}
                              </p>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-3 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleSwitch(config.id)}
                        disabled={switching === config.id}
                      >
                        {switching === config.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-3 w-3 mr-1" />
                            使用
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleOpenEditDialog(config)}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setDeleteTarget(config)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {configs.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-3">
                还没有保存的配置
              </p>
            </div>
          )}

          {/* Save current config button */}
          <Button
            variant="outline"
            className="w-full justify-center gap-2 text-sm"
            onClick={handleOpenSaveDialog}
            disabled={!activeConfig}
          >
            <Plus className="h-4 w-4" />
            保存当前配置
          </Button>
        </CardContent>
      </Card>

      {/* Save Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>保存配置</DialogTitle>
            <DialogDescription>
              为当前正在使用的配置创建一个新的可切换副本
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">配置名称</label>
              <Input
                value={configName}
                onChange={(e) => setConfigName(e.target.value)}
                placeholder="例如: 服务商A / 官方API / 备用节点"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && configName.trim()) {
                    handleSaveConfig();
                  }
                }}
              />
            </div>
            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
              <p className="font-medium mb-1">将保存以下信息：</p>
              <p className="font-mono break-all">Base URL: {currentBaseUrl || 'https://api.anthropic.com'}</p>
              <p className="font-mono">API Key: 保留当前配置中的密钥</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveDialogOpen(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button
              onClick={handleSaveConfig}
              disabled={!configName.trim() || saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>编辑配置</DialogTitle>
            <DialogDescription>
              修改配置的名称、连接信息和这个配置实际可选的模型列表
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">配置名称</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="配置名称"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">API Key</label>
              <div className="flex gap-2">
                <Input
                  type={showEditKey ? 'text' : 'password'}
                  value={editApiKey}
                  onChange={(e) => setEditApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="font-mono text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowEditKey(!showEditKey)}
                >
                  {showEditKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Base URL</label>
              <Input
                value={editBaseUrl}
                onChange={(e) => setEditBaseUrl(e.target.value)}
                placeholder="https://api.anthropic.com"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium">可用模型列表</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {editingModelCount > 0 ? `${editingModelCount} 个手动模型` : '留空则使用 Lumos 内置默认模型'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setEditModelCatalogText('');
                      setEditModelCatalogSource('default');
                      setDetectModelsMessage('');
                      setDetectModelsError('');
                    }}
                  >
                    恢复默认
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleDetectModels}
                    disabled={detectingModels}
                  >
                    {detectingModels ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    探测真实模型
                  </Button>
                </div>
              </div>
              <Textarea
                value={editModelCatalogText}
                onChange={(e) => {
                  setEditModelCatalogText(e.target.value);
                  setEditModelCatalogSource(e.target.value.trim() ? 'manual' : 'default');
                  if (detectModelsMessage) setDetectModelsMessage('');
                  if (detectModelsError) setDetectModelsError('');
                }}
                className="min-h-[160px] font-mono text-xs"
                placeholder={'一行一个模型 ID\n也可写成：model-id | 显示名称\n\n示例：\nclaude-sonnet-4-6 | Claude Sonnet 4.6\nclaude-opus-4-6 | Claude Opus 4.6'}
              />
              {detectModelsMessage && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  {detectModelsMessage}
                </p>
              )}
              {detectModelsError && (
                <p className="text-xs text-destructive">
                  {detectModelsError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                这份列表会直接决定聊天输入框里的模型下拉项。你可以手动填写，也可以点击“探测真实模型”尝试从当前 URL 的 `/v1/models` 拉取。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={updating}
            >
              取消
            </Button>
            <Button
              onClick={handleUpdateConfig}
              disabled={!editName.trim() || updating}
            >
              {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存更改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除配置</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除配置 <strong>{deleteTarget?.name}</strong> 吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={!!deleting}
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
