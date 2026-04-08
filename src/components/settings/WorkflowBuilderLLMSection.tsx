'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface BuilderConfig {
  providerId: string;
  model: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
}

interface ModelOption { providerId: string; providerName: string; value: string; label: string }
interface ProviderOption { id: string; name: string }

export function WorkflowBuilderLLMSection() {
  const [config, setConfig] = useState<BuilderConfig | null>(null);
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
      const res = await fetch('/api/workflow/builder-config');
      const data = await res.json() as BuilderConfig;
      setConfig(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function loadProviderModels() {
    try {
      const res = await fetch('/api/providers/models');
      const data = await res.json() as { groups?: Array<{ provider_id: string; provider_name: string; models: Array<{ value: string; label: string }> }> };
      const models: ModelOption[] = [];
      const provs: ProviderOption[] = [];
      for (const g of data.groups || []) {
        provs.push({ id: g.provider_id, name: g.provider_name });
        for (const m of g.models || [])
          models.push({ providerId: g.provider_id, providerName: g.provider_name, value: m.value, label: m.label });
      }
      setModelOptions(models);
      setProviders(provs);
    } catch { /* ignore */ }
  }

  function startEdit() {
    setProviderId(config?.providerId || '');
    setModel(config?.model || '');
    // Show the saved prompt, or fall back to the default — never show empty
    setPrompt(config?.systemPrompt || config?.defaultSystemPrompt || '');
    setError('');
    setEditing(true);
    void loadProviderModels();
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      // If user hasn't changed anything from the default, save empty to keep using built-in
      const effectivePrompt = prompt === config?.defaultSystemPrompt ? '' : prompt;
      const res = await fetch('/api/workflow/builder-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, model, systemPrompt: effectivePrompt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error || '保存失败');
        return;
      }
      setEditing(false);
      await load();
    } finally { setSaving(false); }
  }

  function handleReset() {
    setProviderId('');
    setModel('');
    setPrompt(config?.defaultSystemPrompt || '');
  }

  if (loading) {
    return <div className="h-20 rounded-lg border border-border/40 bg-muted/30 animate-pulse" />;
  }

  const hasConfig = Boolean(config?.providerId || config?.model || config?.systemPrompt);
  const filteredModels = modelOptions.filter(m => !providerId || m.providerId === providerId);
  const displayPrompt = config?.systemPrompt || config?.defaultSystemPrompt || '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">工作流助手</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AI 生成和修改工作流 DSL 时使用的服务商、模型和系统提示词
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasConfig && (
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400">
              已自定义
            </Badge>
          )}
          {!editing && (
            <Button size="sm" onClick={startEdit}>编辑</Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
          {providers.length > 0 && (
            <div className="space-y-1.5">
              <Label>服务商</Label>
              <Select
                value={providerId || '__default__'}
                onValueChange={v => { setProviderId(v === '__default__' ? '' : v); setModel(''); }}
              >
                <SelectTrigger><SelectValue placeholder="使用默认服务商" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">使用默认服务商</SelectItem>
                  {providers.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>模型</Label>
            <Select
              value={model || '__default__'}
              onValueChange={v => setModel(v === '__default__' ? '' : v)}
            >
              <SelectTrigger><SelectValue placeholder="使用默认模型" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">使用默认模型</SelectItem>
                {filteredModels.map(m => (
                  <SelectItem key={`${m.providerId}/${m.value}`} value={m.value}>
                    <span className="text-muted-foreground text-xs mr-1">[{m.providerName}]</span>{m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>系统提示词</Label>
            <p className="text-xs text-muted-foreground">
              指导 AI 如何生成和修改工作流 DSL。可用 Agent 列表会自动追加到提示词末尾。
            </p>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="min-h-[160px] font-mono text-xs"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleReset}>恢复默认</Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-3">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>服务商: {config?.providerId || '默认'}</span>
            <span>模型: {config?.model || '默认'}</span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              系统提示词{!config?.systemPrompt && ' (默认)'}
            </p>
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap line-clamp-4">
              {displayPrompt}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
