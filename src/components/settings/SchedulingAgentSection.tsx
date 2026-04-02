'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SchedulingRole {
  role: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
  hasOverrides: boolean;
  plannerTimeoutMs?: number;
  defaultPlannerTimeoutMs?: number;
  plannerMaxRetries?: number;
  defaultPlannerMaxRetries?: number;
  preferredProviderId?: string;
  preferredModel?: string;
}

interface ModelOption { providerId: string; providerName: string; value: string; label: string }
interface ProviderOption { id: string; name: string }

export function SchedulingAgentSection() {
  const [role, setRole] = useState<SchedulingRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [timeout, setTimeoutVal] = useState('');
  const [retries, setRetries] = useState('');
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/agents');
      const data = await res.json() as { roles?: SchedulingRole[] };
      const scheduling = (data.roles || []).find(r => r.role === 'scheduling');
      if (scheduling) setRole(scheduling);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

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

  useEffect(() => {
    void load();
    void loadProviderModels();
  }, [load]);

  function startEdit() {
    if (!role) return;
    setPrompt(role.systemPrompt);
    setTimeoutVal(role.plannerTimeoutMs != null ? String(role.plannerTimeoutMs) : '');
    setRetries(role.plannerMaxRetries != null ? String(role.plannerMaxRetries) : '');
    setProviderId(role.preferredProviderId || '');
    setModel(role.preferredModel || '');
    setError('');
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = { systemPrompt: prompt };
      if (timeout) body.plannerTimeoutMs = Number(timeout);
      if (retries) body.plannerMaxRetries = Number(retries);
      if (providerId) body.preferredProviderId = providerId;
      if (model) body.preferredModel = model;
      const res = await fetch('/api/workflow/agents/scheduling', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  async function handleReset() {
    if (!confirm('确认恢复规划代理为默认配置？')) return;
    await fetch('/api/workflow/agents/scheduling', { method: 'DELETE' });
    setEditing(false);
    await load();
  }

  if (loading) {
    return <div className="h-20 rounded-lg border border-border/40 bg-muted/30 animate-pulse" />;
  }

  if (!role) return null;

  const filteredModels = modelOptions.filter(m => !providerId || m.providerId === providerId);
  const providerName = providers.find(p => p.id === role.preferredProviderId)?.name || role.preferredProviderId;
  const timeoutSec = ((role.plannerTimeoutMs ?? role.defaultPlannerTimeoutMs ?? 90000) / 1000).toFixed(0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">规划代理</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            分析用户请求、制定工作流执行计划的 AI 代理
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {role.hasOverrides && (
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400">
              已自定义
            </Badge>
          )}
          {!editing && (
            <>
              {role.hasOverrides && (
                <Button variant="outline" size="sm" onClick={handleReset}>恢复默认</Button>
              )}
              <Button size="sm" onClick={startEdit}>编辑</Button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
          <div className="space-y-1.5">
            <Label>系统提示词</Label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="min-h-[180px] font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>服务商</Label>
              <Select
                value={providerId || '__default__'}
                onValueChange={v => { setProviderId(v === '__default__' ? '' : v); setModel(''); }}
              >
                <SelectTrigger><SelectValue placeholder="使用会话服务商" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">使用会话服务商</SelectItem>
                  {providers.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>模型</Label>
              <Select
                value={model || '__default__'}
                onValueChange={v => setModel(v === '__default__' ? '' : v)}
              >
                <SelectTrigger><SelectValue placeholder="使用会话模型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">使用会话模型</SelectItem>
                  {filteredModels.map(m => (
                    <SelectItem key={`${m.providerId}/${m.value}`} value={m.value}>
                      <span className="text-muted-foreground text-xs mr-1">[{m.providerName}]</span>{m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>规划超时（秒）</Label>
              <Input
                type="number" min={5} max={120} step={5}
                value={timeout ? String(Math.round(Number(timeout) / 1000)) : ''}
                onChange={e => setTimeoutVal(e.target.value ? String(Number(e.target.value) * 1000) : '')}
                placeholder={String((role.defaultPlannerTimeoutMs ?? 90000) / 1000)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>最大重试次数</Label>
              <Input
                type="number" min={0} max={5} step={1}
                value={retries} onChange={e => setRetries(e.target.value)}
                placeholder={String(role.defaultPlannerMaxRetries ?? 2)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-3">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>服务商: {providerName || '会话默认'}</span>
            <span>模型: {role.preferredModel || '会话默认'}</span>
            <span>超时: {timeoutSec} 秒</span>
            <span>重试: {role.plannerMaxRetries ?? role.defaultPlannerMaxRetries ?? 2} 次</span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">系统提示词</p>
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap line-clamp-3">
              {role.systemPrompt}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
