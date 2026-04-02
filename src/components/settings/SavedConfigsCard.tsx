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
  EyeOff,
} from 'lucide-react';
import type { ProviderAuthMode, ProviderCapability, ProviderModelCatalogSource } from '@/types';
import {
  formatProviderModelCatalogForEditor,
  getProviderModelCatalogMeta,
  parseProviderModelCatalogEditor,
  serializeProviderModelCatalog,
} from '@/lib/model-metadata';
import { parseProviderCapabilities, serializeProviderCapabilities } from '@/lib/provider-config';
import { AddProviderDialog } from './AddProviderDialog';

const LOCAL_AUTH_LOGIN_POLL_INTERVAL_MS = 2000;
const LOCAL_AUTH_LOGIN_POLL_TIMEOUT_MS = 60000;

interface SavedConfigsCardProps {
  embedded?: boolean;
  capabilityFilter?: 'agent-chat';
}

interface SavedConfig {
  id: string;
  name: string;
  provider_type: string;
  api_protocol: 'anthropic-messages' | 'openai-compatible';
  capabilities: string;
  auth_mode: ProviderAuthMode;
  provider_origin: string;
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

interface ClaudeLocalAuthStatus {
  available: boolean;
  authenticated: boolean;
  status: 'authenticated' | 'missing' | 'error';
  configDir: string | null;
  runtimeVersion?: string | null;
  authSource?: string | null;
  error?: string;
}

function parseCapabilities(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getCapabilityPurposeLabel(caps: string[]): string {
  if (caps.includes('agent-chat')) return '对话';
  if (caps.includes('image-gen')) return '图片生成';
  if (caps.includes('text-gen')) return '文本';
  if (caps.includes('embedding')) return '嵌入';
  return '对话';
}

function matchesCapabilityFilter(config: SavedConfig, filter?: 'agent-chat'): boolean {
  if (!filter) return true;
  const caps = parseCapabilities(config.capabilities);
  return caps.includes('agent-chat') || caps.length === 0;
}

function getBaseUrlHint(
  apiProtocol: SavedConfig['api_protocol'],
  authMode: ProviderAuthMode,
): string {
  if (authMode === 'local_auth') {
    return '';
  }

  if (apiProtocol === 'anthropic-messages') {
    return 'Anthropic 兼容地址可填写根路径或 /v1；不要手动加 /messages。像小米这类地址填 https://api.xiaomimimo.com/anthropic 即可。';
  }

  return 'OpenAI 兼容地址可填写根路径或 /v1；不要手动加 /chat/completions。';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function SavedConfigsCard({ embedded = false, capabilityFilter }: SavedConfigsCardProps) {
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [defaultProviderId, setDefaultProviderId] = useState('');

  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SavedConfig | null>(null);
  const [editName, setEditName] = useState('');
  const [editAuthMode, setEditAuthMode] = useState<ProviderAuthMode>('api_key');
  const [editApiKey, setEditApiKey] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editModelCatalogText, setEditModelCatalogText] = useState('');
  const [editModelCatalogSource, setEditModelCatalogSource] = useState<ProviderModelCatalogSource>('default');
  const [editCapabilities, setEditCapabilities] = useState<ProviderCapability[]>([]);
  const [showEditKey, setShowEditKey] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [detectingModels, setDetectingModels] = useState(false);
  const [detectModelsMessage, setDetectModelsMessage] = useState('');
  const [detectModelsError, setDetectModelsError] = useState('');
  const [authStatuses, setAuthStatuses] = useState<Record<string, ClaudeLocalAuthStatus>>({});
  const [authStatusLoading, setAuthStatusLoading] = useState<string | null>(null);
  const [authActionMessage, setAuthActionMessage] = useState('');
  const [authActionError, setAuthActionError] = useState('');

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<SavedConfig | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const fetchLocalAuthStatus = useCallback(async (configId: string) => {
    const res = await fetch(`/api/providers/${configId}/auth/status`, {
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({})) as ClaudeLocalAuthStatus & { error?: string };
    if (!res.ok) {
      throw new Error(data.error || '读取 Claude 本地登录状态失败');
    }
    return data;
  }, []);

  const syncLocalAuthStatus = useCallback(async (configId: string) => {
    setAuthStatusLoading(configId);
    try {
      const status = await fetchLocalAuthStatus(configId);
      setAuthStatuses((current) => ({ ...current, [configId]: status }));
      return status;
    } catch (error) {
      const fallbackStatus: ClaudeLocalAuthStatus = {
        available: true,
        authenticated: false,
        status: 'error',
        configDir: null,
        error: error instanceof Error ? error.message : '读取 Claude 本地登录状态失败',
      };
      setAuthStatuses((current) => ({ ...current, [configId]: fallbackStatus }));
      throw error;
    } finally {
      setAuthStatusLoading((current) => (current === configId ? null : current));
    }
  }, [fetchLocalAuthStatus]);

  const pollLocalAuthCompletion = useCallback(async (configId: string) => {
    const startedAt = Date.now();
    let lastStatus: ClaudeLocalAuthStatus | null = null;
    let lastError: Error | null = null;

    while (Date.now() - startedAt < LOCAL_AUTH_LOGIN_POLL_TIMEOUT_MS) {
      await sleep(LOCAL_AUTH_LOGIN_POLL_INTERVAL_MS);

      try {
        const status = await fetchLocalAuthStatus(configId);
        setAuthStatuses((current) => ({ ...current, [configId]: status }));
        lastStatus = status;

        if (status.authenticated) {
          return status;
        }
      } catch (error) {
        lastError = error instanceof Error
          ? error
          : new Error('读取 Claude 本地登录状态失败');
      }
    }

    if (lastStatus) {
      return lastStatus;
    }

    if (lastError) {
      throw lastError;
    }

    return null;
  }, [fetchLocalAuthStatus]);

  const refreshLocalAuthStatuses = useCallback(async (providers: SavedConfig[]) => {
    const localAuthProviders = providers.filter((provider) => (
      provider.provider_type === 'anthropic' && provider.auth_mode === 'local_auth'
    ));

    if (localAuthProviders.length === 0) {
      setAuthStatuses({});
      return;
    }

    const results = await Promise.all(localAuthProviders.map(async (provider) => {
      try {
        const status = await fetchLocalAuthStatus(provider.id);
        return [provider.id, status] as const;
      } catch (error) {
        return [provider.id, {
          available: true,
          authenticated: false,
          status: 'error' as const,
          configDir: null,
          error: error instanceof Error ? error.message : '读取 Claude 本地登录状态失败',
        }] as const;
      }
    }));

    setAuthStatuses(Object.fromEntries(results));
  }, [fetchLocalAuthStatus]);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const providers = data.providers || [];
      setConfigs(providers);
      setDefaultProviderId(data.default_provider_id || '');
      void refreshLocalAuthStatuses(providers);
    } catch (error) {
      console.error('Failed to load configs:', error);
    } finally {
      setLoading(false);
    }
  }, [refreshLocalAuthStatuses]);

  useEffect(() => {
    fetchConfigs();

    // Listen for config changes
    const handleConfigChange = () => fetchConfigs();
    window.addEventListener('provider-changed', handleConfigChange);
    return () => window.removeEventListener('provider-changed', handleConfigChange);
  }, [fetchConfigs]);

  const [switchError, setSwitchError] = useState('');

  const handleSwitch = async (configId: string) => {
    setSwitching(configId);
    setSwitchError('');
    try {
      const res = await fetch(`/api/providers/${configId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      });

      if (res.ok) {
        await fetchConfigs();
        window.dispatchEvent(new Event('provider-changed'));
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setSwitchError(data.error || '切换失败');
      }
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : '切换失败');
    } finally {
      setSwitching(null);
    }
  };

  const handleOpenEditDialog = (config: SavedConfig) => {
    setEditingConfig(config);
    setEditName(config.name);
    setEditCapabilities(parseProviderCapabilities(config.capabilities, config.provider_type));
    setEditAuthMode(config.auth_mode || 'api_key');
    setEditApiKey(config.api_key);
    setEditBaseUrl(config.base_url);
    setEditModelCatalogText(formatProviderModelCatalogForEditor(config.model_catalog));
    setEditModelCatalogSource(config.model_catalog_source);
    setDetectModelsMessage('');
    setDetectModelsError('');
    setUpdateError('');
    setAuthActionMessage('');
    setAuthActionError('');
    setShowEditKey(false);
    setEditDialogOpen(true);
    if (config.provider_type === 'anthropic' && config.auth_mode === 'local_auth') {
      void syncLocalAuthStatus(config.id).catch(() => {});
    }
  };

  const handleDetectModels = async () => {
    if (!editingConfig) return;
    if (editingConfig.provider_type === 'anthropic' && editAuthMode === 'local_auth') {
      setDetectModelsError('Claude 本地登录模式不支持自动探测模型，请使用内置默认模型或手动维护列表');
      setDetectModelsMessage('');
      return;
    }

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
    setUpdateError('');
    try {
      const res = await fetch(`/api/providers/${editingConfig.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          provider_type: editingConfig.provider_type,
          capabilities: serializeProviderCapabilities(editCapabilities, editingConfig.provider_type),
          auth_mode: editAuthMode,
          api_key: editAuthMode === 'local_auth' ? undefined : editApiKey,
          base_url: editAuthMode === 'local_auth' ? undefined : editBaseUrl,
          model_catalog: serializeProviderModelCatalog(modelCatalog),
          model_catalog_source: modelCatalog.length > 0
            ? (editModelCatalogSource === 'detected' ? 'detected' : 'manual')
            : 'default',
          notes: '',
        }),
      });

      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || '保存失败');
      }

      setEditDialogOpen(false);
      setEditingConfig(null);
      await fetchConfigs();
      window.dispatchEvent(new Event('provider-changed'));
    } catch (error) {
      console.error('Failed to update config:', error);
      setUpdateError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setUpdating(false);
    }
  };

  const handleRefreshLocalAuthStatus = async (configId: string) => {
    setAuthActionMessage('');
    setAuthActionError('');
    try {
      const status = await syncLocalAuthStatus(configId);
      if (status.authenticated) {
        setAuthActionMessage('Claude 本地登录可用');
        return;
      }

      if (status.error) {
        setAuthActionError(status.error);
        return;
      }

      setAuthActionMessage('Claude 本地登录未完成或已失效');
    } catch (error) {
      setAuthActionError(error instanceof Error ? error.message : '读取 Claude 本地登录状态失败');
    }
  };

  const handleStartLocalAuthLogin = async (configId: string) => {
    setAuthStatusLoading(configId);
    setAuthActionMessage('');
    setAuthActionError('');
    try {
      const res = await fetch(`/api/providers/${configId}/auth/login`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({})) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || '启动 Claude 本地登录流程失败');
      }

      setAuthActionMessage(data.message || '已打开 Claude 登录终端，请在浏览器完成授权');

      const finalStatus = await pollLocalAuthCompletion(configId);
      if (finalStatus?.authenticated) {
        setAuthActionError('');
        setAuthActionMessage('Claude 本地登录已完成，可关闭终端窗口。');
        return;
      }

      if (finalStatus?.status === 'missing') {
        setAuthActionMessage('');
        setAuthActionError(finalStatus.error || '尚未检测到 Claude 登录完成。请确认终端里执行的是 /login，并在浏览器完成授权。');
        return;
      }

      if (finalStatus?.status === 'error') {
        setAuthActionMessage('');
        setAuthActionError(finalStatus.error || 'Claude 本地登录状态检测失败');
      }
    } catch (error) {
      setAuthActionError(error instanceof Error ? error.message : '启动 Claude 本地登录流程失败');
    } finally {
      setAuthStatusLoading((current) => (current === configId ? null : current));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(deleteTarget.id);
    setDeleteError('');
    try {
      const res = await fetch(`/api/providers/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({})) as { error?: string };

      if (res.ok) {
        setDeleteTarget(null);
        await fetchConfigs();
        window.dispatchEvent(new Event('provider-changed'));
        return;
      }
      setDeleteError(data.error || '删除配置失败');
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除配置失败';
      console.error('Failed to delete config:', error);
      setDeleteError(message);
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

  const filteredConfigs = configs.filter((config) => matchesCapabilityFilter(config, capabilityFilter));
  const activeConfig = filteredConfigs.find((config) => config.id === defaultProviderId)
    || null;
  const inactiveConfigs = filteredConfigs.filter((config) => config.id !== activeConfig?.id);
  const editingModelCount = parseProviderModelCatalogEditor(editModelCatalogText).length;
  const editingConfigId = editingConfig?.id || '';
  const editingLocalAuthStatus = editingConfig ? authStatuses[editingConfig.id] : undefined;
  const isEditingLocalAuth = editingConfig?.provider_type === 'anthropic' && editAuthMode === 'local_auth';

  const getModelCatalogSourceLabel = (source: ProviderModelCatalogSource, usesDefault: boolean) => {
    if (usesDefault || source === 'default') return '内置默认模型';
    if (source === 'detected') return '自动探测模型';
    return '手动维护模型';
  };

  const getModelCatalogMeta = (config: SavedConfig) => {
    const catalogMeta = getProviderModelCatalogMeta(config);
    return {
      count: catalogMeta.models.length,
      usesDefault: catalogMeta.usesDefault,
      sourceLabel: getModelCatalogSourceLabel(catalogMeta.source, catalogMeta.usesDefault),
      updatedAt: catalogMeta.updatedAt,
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

  const getAuthModeLabel = (config: SavedConfig) => {
    if (config.provider_type === 'anthropic' && config.auth_mode === 'local_auth') {
      return 'Claude 本地登录';
    }
    return 'API Key';
  };

  const handleCreatedProvider = async () => {
    await fetchConfigs();
    window.dispatchEvent(new Event('provider-changed'));
  };

  const getLocalAuthStatusMeta = (configId: string) => {
    const status = authStatuses[configId];
    if (!status) {
      return {
        label: '等待检测',
        className: 'bg-muted text-muted-foreground',
      };
    }

    if (status.authenticated) {
      return {
        label: '已登录',
        className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      };
    }

    if (status.status === 'missing') {
      return {
        label: '未登录/已失效',
        className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
      };
    }

    return {
      label: '检测失败',
      className: 'bg-destructive/10 text-destructive',
    };
  };

  const listContent = loading ? (
    <div className="py-8 flex justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  ) : (
    <>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="text-sm font-medium">
            已添加的服务
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            管理对话使用的 AI 服务连接
          </p>
        </div>
        {filteredConfigs.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {filteredConfigs.length} 个
          </Badge>
        )}
      </div>

      {switchError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 mt-2">
          <p className="text-xs text-destructive">{switchError}</p>
        </div>
      )}

      <div className="space-y-3 pt-3">
        {/* Active Config */}
        {activeConfig && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 transition-all">
            <div className="flex items-start gap-3">
              <div className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
	                  {(() => {
	                    const meta = getModelCatalogMeta(activeConfig);
	                    const authMeta = getLocalAuthStatusMeta(activeConfig.id);
	                    return (
	                      <>
	                        <div className="flex items-center gap-2 mb-1">
	                          <p className="font-medium text-sm truncate">{activeConfig.name}</p>
	                          <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
	                            当前使用
	                          </Badge>
	                        </div>
	                        <p className="text-xs text-muted-foreground truncate">
	                          {activeConfig.provider_type === 'anthropic' && activeConfig.auth_mode === 'local_auth'
	                            ? 'Claude 本地登录'
	                            : activeConfig.base_url}
	                        </p>
	                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
	                          <Badge variant="outline" className="text-[10px] h-5">
	                            {getAuthModeLabel(activeConfig)}
	                          </Badge>
	                          {activeConfig.provider_type === 'anthropic' && activeConfig.auth_mode === 'local_auth' && (
	                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${authMeta.className}`}>
	                              {authMeta.label}
	                            </span>
	                          )}
	                          <span>{meta.count} 个模型</span>
                          <span>·</span>
                          <span>更新于 {getTimeAgo(activeConfig.updated_at)}</span>
                        </div>
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
          <div className="space-y-3">
            {inactiveConfigs.map((config) => (
              <div
                key={config.id}
                className="group rounded-lg border border-border/50 px-4 py-3 transition-all hover:border-border hover:shadow-sm hover:bg-accent/30"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-1.5 h-2 w-2 rounded-full bg-muted-foreground/30 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
	                      {(() => {
	                        const meta = getModelCatalogMeta(config);
	                        const authMeta = getLocalAuthStatusMeta(config.id);
	                        return (
	                          <>
	                            <p className="font-medium text-sm truncate">{config.name}</p>
	                            <p className="text-xs text-muted-foreground truncate">
	                              {config.provider_type === 'anthropic' && config.auth_mode === 'local_auth'
	                                ? 'Claude 本地登录'
	                                : config.base_url}
	                            </p>
	                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
	                              <Badge variant="outline" className="text-[10px] h-5">
	                                {getAuthModeLabel(config)}
	                              </Badge>
	                              {config.provider_type === 'anthropic' && config.auth_mode === 'local_auth' ? (
	                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${authMeta.className}`}>
	                                  {authMeta.label}
	                                </span>
	                              ) : config.api_key ? (
	                                <span className="font-mono">{config.api_key.slice(0, 8)}••••</span>
	                              ) : null}
	                              <span>{meta.count} 个模型</span>
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
        {filteredConfigs.length === 0 && (
          <div className="flex flex-col items-center gap-1 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              还没有添加 AI 服务
            </p>
            <p className="text-xs text-muted-foreground/60">
              点击下方添加你的第一个 AI 服务
            </p>
          </div>
        )}

        <Button
          variant="outline"
          className="w-full justify-center gap-2 text-sm"
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          添加服务
        </Button>
      </div>
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="space-y-2">
          {listContent}
        </div>
      ) : (
        <Card className="border-border/50">
          <CardContent className="space-y-2 pt-6">
            {listContent}
          </CardContent>
        </Card>
      )}

      <AddProviderDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        requiredCapability={capabilityFilter === 'agent-chat' ? 'agent-chat' : null}
        title="添加 AI 服务"
        description="选择一个模板快速创建，创建后可继续编辑连接信息和模型列表。"
        onCreated={handleCreatedProvider}
      />

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>编辑服务</DialogTitle>
            <DialogDescription>
              修改名称、连接信息和可选模型
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
	            {editingConfig && (
	              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
	                <span className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5">
	                  用途：{getCapabilityPurposeLabel(parseCapabilities(editingConfig.capabilities))}
	                </span>
	                <span className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5">
	                  {editAuthMode === 'local_auth' ? '本地登录' : 'API Key'}
	                </span>
	                <span className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5">
	                  {editingConfig.provider_type}
	                </span>
	              </div>
	            )}
	            {isEditingLocalAuth ? (
	              <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-4">
	                <div className="flex items-start justify-between gap-4">
	                  <div className="min-w-0">
	                    <p className="text-sm font-medium">Claude 本地登录状态</p>
	                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
	                      检测 Lumos 内置环境的 Claude 登录状态。
	                    </p>
	                  </div>
	                  <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ${getLocalAuthStatusMeta(editingConfigId).className}`}>
	                    {authStatusLoading === editingConfigId ? '检测中' : getLocalAuthStatusMeta(editingConfigId).label}
	                  </span>
	                </div>
	                <div className="flex items-center gap-2">
	                  <Button
	                    type="button"
	                    variant="outline"
	                    size="sm"
	                    className="h-8"
	                    onClick={() => handleRefreshLocalAuthStatus(editingConfigId)}
	                    disabled={authStatusLoading === editingConfigId}
	                  >
	                    {authStatusLoading === editingConfigId ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
	                    重新检测
	                  </Button>
	                  <Button
	                    type="button"
	                    size="sm"
	                    className="h-8"
	                    onClick={() => handleStartLocalAuthLogin(editingConfigId)}
	                    disabled={authStatusLoading === editingConfigId}
	                  >
	                    {authStatusLoading === editingConfigId ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
	                    登录 / 重新登录
	                  </Button>
	                </div>
	                {editingLocalAuthStatus?.configDir && (
	                  <p className="text-[11px] text-muted-foreground/80 break-all leading-relaxed">
	                    配置目录：{editingLocalAuthStatus.configDir}
	                  </p>
	                )}
	                {editingLocalAuthStatus?.authSource && editingLocalAuthStatus.authSource !== 'none' && (
	                  <p className="text-[11px] text-muted-foreground/80">
	                    认证方式：{editingLocalAuthStatus.authSource}
	                  </p>
	                )}
	                {editingLocalAuthStatus?.error && (
	                  <p className="text-xs text-destructive">
	                    {editingLocalAuthStatus.error}
	                  </p>
	                )}
	                {authActionMessage && (
	                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
	                    {authActionMessage}
	                  </p>
	                )}
	                {authActionError && (
	                  <p className="text-xs text-destructive">
	                    {authActionError}
	                  </p>
	                )}
	              </div>
	            ) : (
	              <>
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
	                      type="button"
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
                    <p className="text-xs text-muted-foreground">
                      {getBaseUrlHint(editingConfig?.api_protocol || 'anthropic-messages', editAuthMode)}
                    </p>
	                </div>
	              </>
	            )}
	            <div className="space-y-2">
	              <div className="flex items-center justify-between gap-3">
	                <label className="text-sm font-medium shrink-0">可用模型列表</label>
	                <div className="flex items-center gap-1.5">
	                  <span className="text-[11px] text-muted-foreground/80 hidden sm:inline">
                    {editingModelCount > 0 ? `${editingModelCount} 个手动模型` : '留空用内置默认'}
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
	                    disabled={detectingModels || isEditingLocalAuth}
	                  >
	                    {detectingModels ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
	                    探测模型
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
	                {isEditingLocalAuth
	                  ? '本地登录模式通常使用内置模型列表，一般无需修改。'
	                  : '这里的模型会出现在聊天的模型选择中。可以手动填写，也可以点「探测模型」自动获取。'}
	              </p>
                {updateError && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                    <p className="text-xs text-destructive">{updateError}</p>
                  </div>
                )}
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
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => {
        if (!open) {
          setDeleteTarget(null);
          setDeleteError('');
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 <strong>{deleteTarget?.name}</strong> 吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-xs font-medium text-destructive">删除失败</p>
              <p className="mt-0.5 text-xs text-destructive/80">{deleteError}</p>
            </div>
          )}
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
