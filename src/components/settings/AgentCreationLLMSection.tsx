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

interface AgentCreationConfig {
  providerId: string;
  model: string;
  systemPrompt: string;
}

interface ModelOption { providerId: string; providerName: string; value: string; label: string }
interface ProviderOption { id: string; name: string }

const DEFAULT_PROMPT = `你是专业的 AI Agent 设计师。这些 Agent 将作为工作流中的执行节点，接收调度代理分配的任务 prompt，完成后将结果传递给下游步骤。

根据用户描述，生成包含以下三个字段的 JSON 对象。所有字段内容必须使用中文。

name（2-8 字）
  简洁有力，直接体现 Agent 的核心能力。示例：数据分析师、代码审查专家、文案助手

description（1-2 句话）
  说明主要用途和适用的任务类型，帮助调度代理和用户判断何时选用此 Agent。

systemPrompt（200 字以上，中文）
  定义 Agent 在工作流步骤中的行为规范，必须包含：
  • 角色定位：明确专业领域和核心能力
  • 任务执行：如何处理收到的 prompt，以及如何利用上游步骤传入的 context
  • 上游数据处理：当 I/O Contract 中提供了上游步骤的产出物文件路径时，必须读取这些文件获取完整原始内容；不要重复抓取上游已经收集好的数据
  • 原始数据保存：搜索/爬取类 Agent 必须将获取到的完整原始内容保存为文件，禁止对原始内容做摘要或提炼后再保存；后续分析类步骤依赖完整原始数据进行深度分析
  • 文件输出：所有产出物（报告、数据文件、采集内容等）必须写入 I/O Contract 指定的 Artifact Output Dir，不要写入 shared 目录
  • 工作边界：只执行分配给本步骤的任务，完成后立即返回结果；不要提前做下游步骤的工作（例如：负责搜索的 Agent 只搜集资料，不做分析；负责分析的 Agent 基于提供的资料分析，不再重新搜索）
  • 输出规范：输出格式、质量要求，确保下游步骤可以直接消费结果
  结构清晰，直接可用于生产环境。

如果是浏览器操作类 Agent（涉及网页自动化、数据采集、表单填写、页面交互等），systemPrompt 中必须额外包含：
  • 工具调用顺序：每次操作前先调用 mcp__browser__browser_list_pages 获取可用页面及 pageId，再用该 pageId 调用其他工具
  • 页面分析：交互前调用 mcp__browser__browser_snapshot 获取页面可交互元素列表（每个元素有唯一 uid），点击或填写必须基于 snapshot 返回的 uid
  • 可用工具清单（在 systemPrompt 中明确列出）：
    - mcp__browser__browser_list_pages — 列出所有标签页
    - mcp__browser__browser_open_page — 打开新标签页，参数 url
    - mcp__browser__browser_navigate — 导航，参数 pageId、type(url/back/forward/reload)、url
    - mcp__browser__browser_snapshot — 获取页面结构和可交互元素（uid），参数 pageId
    - mcp__browser__browser_click — 点击元素，参数 pageId、uid
    - mcp__browser__browser_fill — 清空并填写输入框，参数 pageId、uid、value
    - mcp__browser__browser_type — 向聚焦元素输入文字，参数 pageId、text、submitKey(Enter/Tab)
    - mcp__browser__browser_screenshot — 截图，参数 pageId
    - mcp__browser__browser_evaluate — 执行 JavaScript，参数 pageId、expression
    - mcp__browser__browser_wait_for — 等待文字出现，参数 pageId、text(数组)、timeoutMs
    - mcp__browser__browser_close_page — 关闭标签页，参数 pageId
  • 登录态说明：浏览器与用户共享登录态，可直接访问用户已登录的网站，无需重新认证

直接输出 JSON，不添加任何解释文字。`;

export function AgentCreationLLMSection() {
  const [config, setConfig] = useState<AgentCreationConfig | null>(null);
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
      const res = await fetch('/api/workflow/agent-creation-config');
      const data = await res.json() as AgentCreationConfig;
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
    setPrompt(config?.systemPrompt || '');
    setError('');
    setEditing(true);
    void loadProviderModels();
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/workflow/agent-creation-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, model, systemPrompt: prompt }),
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
    if (!confirm('确认清除 Agent 生成配置，恢复为默认值？')) return;
    await fetch('/api/workflow/agent-creation-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: '', model: '', systemPrompt: '' }),
    });
    setEditing(false);
    await load();
  }

  if (loading) {
    return <div className="h-20 rounded-lg border border-border/40 bg-muted/30 animate-pulse" />;
  }

  const hasConfig = Boolean(config?.providerId || config?.model || config?.systemPrompt);
  const filteredModels = modelOptions.filter(m => !providerId || m.providerId === providerId);
  const displayPrompt = config?.systemPrompt || DEFAULT_PROMPT;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">Agent 生成助手</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AI 辅助生成 Agent 配置时使用的服务商、模型和系统提示词
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasConfig && (
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400">
              已自定义
            </Badge>
          )}
          {!editing && (
            <>
              {hasConfig && (
                <Button variant="outline" size="sm" onClick={handleReset}>恢复默认</Button>
              )}
              <Button size="sm" onClick={startEdit}>编辑</Button>
            </>
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
              指导 AI 如何生成 Agent 配置的提示词，留空则使用内置默认提示词
            </p>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={DEFAULT_PROMPT}
              className="min-h-[160px] font-mono text-xs"
            />
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
            <span>服务商: {config?.providerId || '默认'}</span>
            <span>模型: {config?.model || '默认'}</span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">系统提示词{config?.systemPrompt ? '' : '（内置默认）'}</p>
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap line-clamp-3">
              {displayPrompt}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
