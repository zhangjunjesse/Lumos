'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { Loader2, Eye, EyeOff } from 'lucide-react';
import {
  formatProviderModelCatalogForEditor,
  getProviderModelCatalogMeta,
  parseProviderModelCatalogEditor,
  serializeProviderModelCatalog,
} from '@/lib/model-metadata';
import {
  parseProviderCapabilities,
  serializeProviderCapabilities,
} from '@/lib/provider-config';
import type { ProviderAuthMode, ProviderModelCatalogSource } from '@/types';

export interface ProviderEditTarget {
  id: string;
  name: string;
  provider_type: string;
  api_protocol: 'anthropic-messages' | 'openai-compatible';
  capabilities: string;
  auth_mode: ProviderAuthMode;
  base_url: string;
  api_key: string;
  model_catalog: string;
  model_catalog_source: ProviderModelCatalogSource;
  model_catalog_updated_at: string | null;
}

interface ProviderEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderEditTarget | null;
  onSaved?: () => void | Promise<void>;
}

function getCapabilityPurposeLabel(caps: string[]): string {
  if (caps.includes('agent-chat')) return '对话';
  if (caps.includes('image-gen')) return '图片生成';
  if (caps.includes('text-gen')) return '文本';
  if (caps.includes('embedding')) return '嵌入';
  return '对话';
}

function getBaseUrlHint(
  apiProtocol: ProviderEditTarget['api_protocol'],
  authMode: ProviderAuthMode,
): string {
  if (authMode === 'local_auth') return '';
  if (apiProtocol === 'anthropic-messages') {
    return 'Anthropic 兼容地址可填写根路径或 /v1，不要手动加 /messages。';
  }
  return 'OpenAI 兼容地址可填写根路径或 /v1，不要手动加 /chat/completions。';
}

export function ProviderEditDialog({
  open,
  onOpenChange,
  provider,
  onSaved,
}: ProviderEditDialogProps) {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelCatalogText, setModelCatalogText] = useState('');
  const [modelCatalogSource, setModelCatalogSource] = useState<ProviderModelCatalogSource>('default');
  const [showKey, setShowKey] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [detectingModels, setDetectingModels] = useState(false);
  const [detectMessage, setDetectMessage] = useState('');
  const [detectError, setDetectError] = useState('');

  const resetForm = useCallback((p: ProviderEditTarget) => {
    setName(p.name);
    setApiKey(p.api_key);
    setBaseUrl(p.base_url);
    setModelCatalogText(formatProviderModelCatalogForEditor(p.model_catalog));
    setModelCatalogSource(p.model_catalog_source);
    setShowKey(false);
    setUpdating(false);
    setUpdateError('');
    setDetectMessage('');
    setDetectError('');
  }, []);

  useEffect(() => {
    if (open && provider) resetForm(provider);
  }, [open, provider, resetForm]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  const handleDetectModels = async () => {
    if (!provider) return;
    setDetectingModels(true);
    setDetectMessage('');
    setDetectError('');
    try {
      const res = await fetch(`/api/providers/${provider.id}/models/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          apiKey,
          providerType: provider.provider_type,
        }),
      });
      const data = await res.json().catch(() => ({})) as {
        models?: Array<{ value: string; label: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || '探测模型失败');
      const models = Array.isArray(data.models) ? data.models : [];
      const catalog = serializeProviderModelCatalog(models);
      setModelCatalogText(formatProviderModelCatalogForEditor(catalog));
      setModelCatalogSource('detected');
      setDetectMessage(`已探测到 ${models.length} 个模型`);
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : '探测模型失败');
    } finally {
      setDetectingModels(false);
    }
  };

  const handleSave = async () => {
    if (!provider || !name.trim()) return;
    const modelCatalog = parseProviderModelCatalogEditor(modelCatalogText);
    const capabilities = parseProviderCapabilities(provider.capabilities, provider.provider_type);
    setUpdating(true);
    setUpdateError('');
    try {
      const res = await fetch(`/api/providers/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          provider_type: provider.provider_type,
          capabilities: serializeProviderCapabilities(capabilities, provider.provider_type),
          auth_mode: provider.auth_mode,
          api_key: provider.auth_mode === 'local_auth' ? undefined : apiKey,
          base_url: provider.auth_mode === 'local_auth' ? undefined : baseUrl,
          model_catalog: serializeProviderModelCatalog(modelCatalog),
          model_catalog_source: modelCatalog.length > 0
            ? (modelCatalogSource === 'detected' ? 'detected' : 'manual')
            : 'default',
          notes: '',
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || '保存失败');
      onOpenChange(false);
      await onSaved?.();
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setUpdating(false);
    }
  };

  const editingModelCount = parseProviderModelCatalogEditor(modelCatalogText).length;
  const caps = provider ? parseProviderCapabilities(provider.capabilities, provider.provider_type) : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>编辑服务</DialogTitle>
          <DialogDescription>修改名称、连接信息和可选模型</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">配置名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="配置名称" />
          </div>
          {provider && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5">
                用途：{getCapabilityPurposeLabel(caps)}
              </span>
              <span className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5">
                {provider.auth_mode === 'local_auth' ? '本地登录' : 'API Key'}
              </span>
              <span className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5">
                {provider.provider_type}
              </span>
            </div>
          )}
          {provider && provider.auth_mode !== 'local_auth' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <div className="flex gap-2">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="font-mono text-sm"
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setShowKey(!showKey)}>
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://..."
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {getBaseUrlHint(provider.api_protocol, provider.auth_mode)}
                </p>
              </div>
            </>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium shrink-0">可用模型列表</label>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground/80 hidden sm:inline">
                  {editingModelCount > 0 ? `${editingModelCount} 个模型` : '留空用内置默认'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setModelCatalogText('');
                    setModelCatalogSource('default');
                    setDetectMessage('');
                    setDetectError('');
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
                  探测模型
                </Button>
              </div>
            </div>
            <Textarea
              value={modelCatalogText}
              onChange={(e) => {
                setModelCatalogText(e.target.value);
                setModelCatalogSource(e.target.value.trim() ? 'manual' : 'default');
                if (detectMessage) setDetectMessage('');
                if (detectError) setDetectError('');
              }}
              className="min-h-[120px] font-mono text-xs"
              placeholder={'一行一个模型 ID\n也可写成：model-id | 显示名称'}
            />
            {detectMessage && <p className="text-xs text-emerald-600 dark:text-emerald-400">{detectMessage}</p>}
            {detectError && <p className="text-xs text-destructive">{detectError}</p>}
          </div>
          {updateError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-xs text-destructive">{updateError}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updating}>取消</Button>
          <Button onClick={handleSave} disabled={!name.trim() || updating}>
            {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存更改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Utility: get model count from a provider's catalog */
export function getProviderModelCount(provider: ProviderEditTarget): number {
  return getProviderModelCatalogMeta(provider).models.length;
}
