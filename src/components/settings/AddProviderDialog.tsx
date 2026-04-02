'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { serializeProviderCapabilities } from '@/lib/provider-config';
import type {
  ApiProvider,
  ProviderCapability,
  ProviderPresetModule,
  ProviderPreset,
} from '@/types';

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (provider: ApiProvider) => void | Promise<void>;
  requiredCapability?: ProviderCapability | null;
  targetModule?: ProviderPresetModule | null;
  title?: string;
  description?: string;
}

function getCapabilityLabel(capability: ProviderCapability): string {
  switch (capability) {
    case 'agent-chat':
      return '对话';
    case 'text-gen':
      return '文本处理';
    case 'image-gen':
      return '图片生成';
    case 'embedding':
      return '文本嵌入';
    default:
      return capability;
  }
}

function getProtocolLabel(protocol: ProviderPreset['api_protocol']): string {
  return protocol === 'openai-compatible' ? 'OpenAI 兼容' : 'Anthropic Messages';
}

function getBaseUrlHint(
  protocol: ProviderPreset['api_protocol'],
  authMode: ProviderPreset['auth_mode'],
): string {
  if (authMode === 'local_auth') {
    return '';
  }

  if (protocol === 'anthropic-messages') {
    return 'Anthropic 兼容地址可填写根路径或 /v1，例如 https://api.anthropic.com 或 https://api.xiaomimimo.com/anthropic；不要手动加 /messages。';
  }

  return 'OpenAI 兼容地址可填写根路径或 /v1，例如 https://api.deepseek.com 或 https://api.moonshot.cn/v1；不要手动加 /chat/completions。';
}

export function AddProviderDialog({
  open,
  onOpenChange,
  onCreated,
  requiredCapability,
  targetModule,
  title = '添加服务',
  description = '选择模板快速创建，创建后可继续编辑连接信息和模型。',
}: AddProviderDialogProps) {
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) || null,
    [presets, selectedPresetId],
  );

  const applyPreset = useCallback((preset: ProviderPreset) => {
    setSelectedPresetId(preset.id);
    setName(preset.name);
    setApiKey('');
    setBaseUrl(preset.base_url || '');
    setError('');
    setShowApiKey(false);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const loadPresets = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (requiredCapability) {
          params.set('capability', requiredCapability);
        }
        if (targetModule) {
          params.set('module', targetModule);
        }
        const search = params.toString() ? `?${params.toString()}` : '';
        const res = await fetch(`/api/providers/presets${search}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({})) as { presets?: ProviderPreset[]; error?: string };
        if (!res.ok) {
          throw new Error(data.error || '读取模板失败');
        }
        const nextPresets = Array.isArray(data.presets) ? data.presets : [];
        if (cancelled) return;
        setPresets(nextPresets);
        if (nextPresets.length > 0) {
          const nextSelected = nextPresets.find((item) => item.id === selectedPresetId) || nextPresets[0];
          applyPreset(nextSelected);
        } else {
          setSelectedPresetId('');
          setName('');
          setApiKey('');
          setBaseUrl('');
        }
      } catch (fetchError) {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : '读取模板失败');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPresets();
    return () => {
      cancelled = true;
    };
  }, [applyPreset, open, requiredCapability, targetModule]);

  const handleCreate = async () => {
    if (!selectedPreset || !name.trim()) {
      return;
    }

    if (selectedPreset.requires_base_url && !baseUrl.trim()) {
      setError('当前模板必须填写 Base URL。');
      return;
    }

    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          provider_type: selectedPreset.provider_type,
          api_protocol: selectedPreset.api_protocol,
          capabilities: serializeProviderCapabilities(
            selectedPreset.capabilities,
            selectedPreset.provider_type,
          ),
          provider_origin: selectedPreset.provider_origin,
          auth_mode: selectedPreset.auth_mode,
          base_url: selectedPreset.auth_mode === 'local_auth'
            ? selectedPreset.base_url
            : baseUrl.trim(),
          api_key: selectedPreset.auth_mode === 'local_auth'
            ? ''
            : apiKey.trim(),
          notes: selectedPreset.notes || '',
          ...(selectedPreset.default_models?.length
            ? {
                model_catalog: JSON.stringify(selectedPreset.default_models),
                model_catalog_source: 'default' as const,
              }
            : {}),
        }),
      });

      const data = await res.json().catch(() => ({})) as { provider?: ApiProvider; error?: string };
      if (!res.ok || !data.provider) {
        throw new Error(data.error || '创建失败');
      }

      await onCreated?.(data.provider);
      onOpenChange(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const localDescription = requiredCapability === 'agent-chat'
    ? '这里展示适用于对话的服务模板。其他功能的服务请到下方分别添加。'
    : targetModule === 'knowledge'
      ? '这里展示适用于知识库的服务模板。'
    : requiredCapability === 'image-gen'
      ? '这里展示适用于图片生成的服务模板。'
      : description;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{localDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4 sm:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-2">
            <p className="text-sm font-medium">选择模板</p>
            <ScrollArea className="h-[320px] rounded-lg border border-border/60">
              <div className="space-y-2 p-2">
                {loading ? (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在读取模板
                  </div>
                ) : presets.length === 0 ? (
                  <div className="px-3 py-8 text-sm text-muted-foreground">
                    当前没有可用模板。
                  </div>
                ) : presets.map((preset) => {
                  const selected = preset.id === selectedPresetId;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                        selected
                          ? 'border-primary bg-primary/5'
                          : 'border-border/60 hover:border-border hover:bg-accent/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{preset.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>
                        </div>
                        <Badge variant={selected ? 'default' : 'outline'} className="shrink-0 text-[10px]">
                          {getProtocolLabel(preset.api_protocol)}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {preset.capabilities.map((capability) => (
                          <Badge key={capability} variant="secondary" className="text-[10px]">
                            {getCapabilityLabel(capability)}
                          </Badge>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">配置名称</label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：Claude 生产 / OpenRouter 备用"
                autoFocus
              />
            </div>

            {selectedPreset && (
              <>
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5">
                      {selectedPreset.provider_type}
                    </span>
                    <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5">
                      {selectedPreset.auth_mode === 'local_auth' ? '本地登录' : 'API Key'}
                    </span>
                    <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5">
                      来源：{selectedPreset.provider_origin === 'preset' ? '预设模板' : selectedPreset.provider_origin}
                    </span>
                  </div>
                  {selectedPreset.notes && (
                    <p className="mt-2 text-xs text-muted-foreground">{selectedPreset.notes}</p>
                  )}
                </div>

                {selectedPreset.auth_mode !== 'local_auth' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">API Key</label>
                      <div className="flex gap-2">
                        <Input
                          type={showApiKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder="可先留空，稍后再补"
                          className="font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setShowApiKey((current) => !current)}
                        >
                          {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Base URL</label>
                      <Input
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder={selectedPreset.base_url || '请填写 API 地址'}
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        {getBaseUrlHint(selectedPreset.api_protocol, selectedPreset.auth_mode)}
                      </p>
                    </div>
                  </>
                )}

                {selectedPreset.auth_mode === 'local_auth' && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                    本地登录无需填写 API Key。创建后在编辑页面完成登录即可。
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={!selectedPreset || !name.trim() || creating}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
