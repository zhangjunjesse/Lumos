'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface AppBuilderConfig {
  providerId: string;
  model: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
  providerModels?: {
    groups?: Array<{
      provider_id: string;
      provider_name: string;
      models: Array<{ value: string; label: string }>;
    }>;
    default_provider_id?: string;
  };
}

interface ModelOption {
  providerId: string;
  providerName: string;
  value: string;
  label: string;
}

interface ProviderOption {
  id: string;
  name: string;
}

export function AppBuilderLLMSection() {
  const [config, setConfig] = useState<AppBuilderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/apps/builder/config');
      const data = (await res.json()) as AppBuilderConfig;
      setConfig(data);
    } catch {
      // The section stays non-blocking; save will surface actionable errors.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadProviderModels() {
    const configuredGroups = config?.providerModels?.groups;
    if (configuredGroups?.length) {
      applyProviderModelGroups(configuredGroups);
      return;
    }

    try {
      const res = await fetch('/api/providers/models');
      const data = (await res.json()) as {
        groups?: Array<{
          provider_id: string;
          provider_name: string;
          models: Array<{ value: string; label: string }>;
        }>;
      };
      applyProviderModelGroups(data.groups ?? []);
    } catch {
      // Keep editing usable even if model discovery fails.
    }
  }

  function applyProviderModelGroups(groups: NonNullable<AppBuilderConfig['providerModels']>['groups']) {
    const models: ModelOption[] = [];
    const nextProviders: ProviderOption[] = [];
    for (const group of groups || []) {
      nextProviders.push({ id: group.provider_id, name: group.provider_name });
      for (const option of group.models || []) {
        models.push({
          providerId: group.provider_id,
          providerName: group.provider_name,
          value: option.value,
          label: option.label,
        });
      }
    }
    setModelOptions(models);
    setProviders(nextProviders);
  }

  function startEdit() {
    setProviderId(config?.providerId || '');
    setModel(config?.model || '');
    setPrompt(config?.systemPrompt || config?.defaultSystemPrompt || '');
    setError('');
    setEditing(true);
    void loadProviderModels();
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const effectivePrompt = prompt === config?.defaultSystemPrompt ? '' : prompt;
      const res = await fetch('/api/apps/builder/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, model, systemPrompt: effectivePrompt }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || '保存失败');
        return;
      }
      setEditing(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setProviderId('');
    setModel('');
    setPrompt(config?.defaultSystemPrompt || '');
  }

  if (loading) {
    return <div className="h-20 rounded-lg border border-border/40 bg-muted/30" />;
  }

  const hasConfig = Boolean(config?.providerId || config?.model || config?.systemPrompt);
  const effectiveProviderId = config?.providerId || config?.providerModels?.default_provider_id || '';
  const filteredModels = modelOptions.filter((option) => !providerId || option.providerId === providerId);
  const displayPrompt = config?.systemPrompt || config?.defaultSystemPrompt || '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">应用开发助手</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            应用开发界面右侧真实 AI 对话使用的服务商、模型和系统提示词。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasConfig ? (
            <Badge variant="outline" className="text-xs">
              已自定义
            </Badge>
          ) : null}
          {!editing ? (
            <Button size="sm" onClick={startEdit}>
              编辑
            </Button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
          {providers.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>服务商</Label>
              <Select
                value={providerId || '__default__'}
                onValueChange={(value) => {
                  setProviderId(value === '__default__' ? '' : value);
                  setModel('');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="使用默认服务商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">使用默认服务商</SelectItem>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label>模型</Label>
            <Select
              value={model || '__default__'}
              onValueChange={(value) => setModel(value === '__default__' ? '' : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="使用默认模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">使用默认模型</SelectItem>
                {filteredModels.map((option) => (
                  <SelectItem key={`${option.providerId}/${option.value}`} value={option.value}>
                    [{option.providerName}] {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>系统提示词</Label>
            <p className="text-xs text-muted-foreground">
              控制右侧应用开发助手如何理解需求、生成应用文件和迭代预览。
            </p>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-h-[180px] font-mono text-xs"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleReset}>
              恢复默认
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border/40 bg-muted/20 p-4">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>服务商: {effectiveProviderId || '默认'}</span>
            <span>模型: {config?.model || '默认'}</span>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              系统提示词{!config?.systemPrompt ? ' (默认)' : ''}
            </p>
            <pre className="line-clamp-4 whitespace-pre-wrap font-mono text-xs text-foreground/80">
              {displayPrompt}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
