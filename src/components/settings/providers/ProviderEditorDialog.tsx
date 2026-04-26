'use client';

import { useEffect, useState } from 'react';
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
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import type { ProviderAuthMode, ProviderCapability, ProviderModelCatalogSource } from '@/types';
import {
  formatProviderModelCatalogForEditor,
  parseProviderModelCatalogEditor,
  serializeProviderModelCatalog,
} from '@/lib/model-metadata';
import {
  parseProviderCapabilities,
  serializeProviderCapabilities,
} from '@/lib/provider-config';
import {
  getBaseUrlHint,
  getCapabilityPurposeLabel,
  parseCapabilities,
  type SavedConfig,
} from './shared';
import { useLocalAuth } from './useLocalAuth';
import { LocalAuthPanel } from './LocalAuthPanel';

interface DetectModelsResponse {
  models: Array<{ value: string; label: string }>;
}

interface Props {
  open: boolean;
  config: SavedConfig | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function useEditorForm(config: SavedConfig | null, open: boolean) {
  const [name, setName] = useState('');
  const [authMode, setAuthMode] = useState<ProviderAuthMode>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [catalogText, setCatalogText] = useState('');
  const [catalogSource, setCatalogSource] = useState<ProviderModelCatalogSource>('default');
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);

  // TODO: refactor to derive form state from config via useMemo + key prop instead
  // of syncing through setState. Current pattern triggers a cascade re-render on
  // every dialog open; fine for now since the dialog is short-lived.
  useEffect(() => {
    if (!open || !config) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(config.name);
    setCapabilities(parseProviderCapabilities(config.capabilities, config.provider_type));
    setAuthMode(config.auth_mode || 'api_key');
    setApiKey(config.api_key);
    setBaseUrl(config.base_url);
    setCatalogText(formatProviderModelCatalogForEditor(config.model_catalog));
    setCatalogSource(config.model_catalog_source);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, config]);

  return {
    name, setName,
    authMode, setAuthMode,
    apiKey, setApiKey,
    baseUrl, setBaseUrl,
    catalogText, setCatalogText,
    catalogSource, setCatalogSource,
    capabilities, setCapabilities,
  };
}

export function ProviderEditorDialog({ open, config, onOpenChange, onSaved }: Props) {
  const form = useEditorForm(config, open);
  const [showKey, setShowKey] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState('');
  const [detectErr, setDetectErr] = useState('');
  const localAuth = useLocalAuth();

  useEffect(() => {
    if (!open || !config) return;
    setShowKey(false);
    setUpdating(false);
    setUpdateError('');
    setDetecting(false);
    setDetectMsg('');
    setDetectErr('');
    localAuth.clearMessages();
    if (config.provider_type === 'anthropic' && config.auth_mode === 'local_auth') {
      void localAuth.refresh(config.id);
    }
  // localAuth intentionally omitted to avoid re-priming on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  if (!config) return null;

  const isEditingLocalAuth = config.provider_type === 'anthropic' && form.authMode === 'local_auth';
  const modelCount = parseProviderModelCatalogEditor(form.catalogText).length;

  const handleDetect = async () => {
    if (isEditingLocalAuth) {
      setDetectErr('Claude 本地登录模式不支持自动探测模型，请使用内置默认模型或手动维护列表');
      setDetectMsg('');
      return;
    }
    setDetecting(true);
    setDetectMsg('');
    setDetectErr('');
    try {
      const res = await fetch(`/api/providers/${config.id}/models/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          providerType: config.provider_type,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<DetectModelsResponse> & { error?: string };
      if (!res.ok) throw new Error(data.error || '探测模型失败');
      const models = Array.isArray(data.models) ? data.models : [];
      const catalog = serializeProviderModelCatalog(models);
      form.setCatalogText(formatProviderModelCatalogForEditor(catalog));
      form.setCatalogSource('detected');
      setDetectMsg(`已探测到 ${models.length} 个模型`);
    } catch (error) {
      setDetectErr(error instanceof Error ? error.message : '探测模型失败');
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const catalog = parseProviderModelCatalogEditor(form.catalogText);
    setUpdating(true);
    setUpdateError('');
    try {
      const res = await fetch(`/api/providers/${config.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          provider_type: config.provider_type,
          capabilities: serializeProviderCapabilities(form.capabilities, config.provider_type),
          auth_mode: form.authMode,
          api_key: form.authMode === 'local_auth' ? undefined : form.apiKey,
          base_url: form.authMode === 'local_auth' ? undefined : form.baseUrl,
          model_catalog: serializeProviderModelCatalog(catalog),
          model_catalog_source: catalog.length > 0
            ? (form.catalogSource === 'detected' ? 'detected' : 'manual')
            : 'default',
          notes: '',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || '保存失败');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>编辑服务</DialogTitle>
          <DialogDescription>修改名称、连接信息和可选模型</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">配置名称</label>
            <Input value={form.name} onChange={(e) => form.setName(e.target.value)} placeholder="配置名称" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5">
              用途：{getCapabilityPurposeLabel(parseCapabilities(config.capabilities))}
            </span>
            <span className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5">
              {form.authMode === 'local_auth' ? '本地登录' : 'API Key'}
            </span>
            <span className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5">
              {config.provider_type}
            </span>
          </div>
          {isEditingLocalAuth ? (
            <LocalAuthPanel configId={config.id} auth={localAuth} />
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <div className="flex gap-2">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(e) => form.setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
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
                  value={form.baseUrl}
                  onChange={(e) => form.setBaseUrl(e.target.value)}
                  placeholder="https://api.anthropic.com"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {getBaseUrlHint(config.api_protocol, form.authMode)}
                </p>
              </div>
            </>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium shrink-0">可用模型列表</label>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground/80 hidden sm:inline">
                  {modelCount > 0 ? `${modelCount} 个手动模型` : '留空用内置默认'}
                </span>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                  onClick={() => {
                    form.setCatalogText('');
                    form.setCatalogSource('default');
                    setDetectMsg('');
                    setDetectErr('');
                  }}>
                  恢复默认
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs"
                  onClick={handleDetect} disabled={detecting || isEditingLocalAuth}>
                  {detecting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  探测模型
                </Button>
              </div>
            </div>
            <Textarea
              value={form.catalogText}
              onChange={(e) => {
                form.setCatalogText(e.target.value);
                form.setCatalogSource(e.target.value.trim() ? 'manual' : 'default');
                if (detectMsg) setDetectMsg('');
                if (detectErr) setDetectErr('');
              }}
              className="min-h-[160px] font-mono text-xs"
              placeholder={'一行一个模型 ID\n也可写成：model-id | 显示名称\n\n示例：\nclaude-sonnet-4-6 | Claude Sonnet 4.6\nclaude-opus-4-6 | Claude Opus 4.6'}
            />
            {detectMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{detectMsg}</p>}
            {detectErr && <p className="text-xs text-destructive">{detectErr}</p>}
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updating}>取消</Button>
          <Button onClick={handleSave} disabled={!form.name.trim() || updating}>
            {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存更改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
