'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentPresetDirectoryItem, AgentPresetToolPermissions } from '@/types';

interface McpServerOption {
  id: string;
  name: string;
  scope: string;
}

interface ModelOption {
  providerId: string;
  providerName: string;
  value: string;
  label: string;
}

interface AgentPresetEditorProps {
  open: boolean;
  initial?: AgentPresetDirectoryItem | null;
  onClose: () => void;
  onSave: (data: AgentPresetFormData) => Promise<void>;
}

export interface AgentPresetFormData {
  name: string;
  roleKind: 'orchestrator' | 'lead' | 'worker';
  responsibility: string;
  systemPrompt: string;
  description: string;
  preferredModel: string;
  mcpServers: string[];
  toolPermissions: AgentPresetToolPermissions;
}

const ROLE_OPTIONS = [
  { value: 'orchestrator', label: '编排者 (Orchestrator)', desc: '负责任务规划和协调' },
  { value: 'lead', label: '负责人 (Lead)', desc: '负责某个专项领域' },
  { value: 'worker', label: '执行者 (Worker)', desc: '执行具体的工作步骤' },
] as const;

function defaultForm(initial?: AgentPresetDirectoryItem | null): AgentPresetFormData {
  return {
    name: initial?.name ?? '',
    roleKind: (initial?.roleKind as AgentPresetFormData['roleKind']) ?? 'worker',
    responsibility: initial?.responsibility ?? '',
    systemPrompt: initial?.systemPrompt ?? '',
    description: initial?.description ?? '',
    preferredModel: initial?.preferredModel ?? '',
    mcpServers: initial?.mcpServers ?? [],
    toolPermissions: initial?.toolPermissions ?? { read: true, write: false, exec: false },
  };
}

export function AgentPresetEditor({ open, initial, onClose, onSave }: AgentPresetEditorProps) {
  const [form, setForm] = useState<AgentPresetFormData>(() => defaultForm(initial));
  const [saving, setSaving] = useState(false);
  const [mcpOptions, setMcpOptions] = useState<McpServerOption[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  useEffect(() => {
    if (open) {
      setForm(defaultForm(initial));
      setSaving(false);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/plugins/mcp')
      .then(r => r.json())
      .then(data => {
        const servers: McpServerOption[] = (data.servers || []).map((s: { id: string; name: string; scope?: string }) => ({
          id: s.id, name: s.name, scope: s.scope || 'user',
        }));
        setMcpOptions(servers);
      })
      .catch(() => {});
    fetch('/api/providers/models')
      .then(r => r.json())
      .then(data => {
        const models: ModelOption[] = [];
        for (const group of data.groups || []) {
          for (const m of group.models || []) {
            models.push({ providerId: group.provider_id, providerName: group.provider_name, value: m.value, label: m.label });
          }
        }
        setModelOptions(models);
      })
      .catch(() => {});
  }, [open]);

  function set<K extends keyof AgentPresetFormData>(key: K, value: AgentPresetFormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function toggleMcp(id: string) {
    setForm(prev => ({
      ...prev,
      mcpServers: prev.mcpServers.includes(id)
        ? prev.mcpServers.filter(x => x !== id)
        : [...prev.mcpServers, id],
    }));
  }

  function toggleTool(key: keyof AgentPresetToolPermissions) {
    setForm(prev => ({
      ...prev,
      toolPermissions: { ...prev.toolPermissions, [key]: !prev.toolPermissions[key] },
    }));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.responsibility.trim() || !form.systemPrompt.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const isEdit = Boolean(initial);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑 Agent 配置' : '新建 Agent 配置'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name + Role */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>名称 *</Label>
              <Input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="例如：资料研究专家"
              />
            </div>
            <div className="space-y-1.5">
              <Label>角色类型 *</Label>
              <Select value={form.roleKind} onValueChange={v => set('roleKind', v as AgentPresetFormData['roleKind'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>简介</Label>
            <Input
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="简要描述这个 Agent 的用途"
            />
          </div>

          {/* Responsibility */}
          <div className="space-y-1.5">
            <Label>职责范围 *</Label>
            <Input
              value={form.responsibility}
              onChange={e => set('responsibility', e.target.value)}
              placeholder="例如：负责从网络和知识库中收集资料并整理摘要"
            />
          </div>

          {/* System Prompt */}
          <div className="space-y-1.5">
            <Label>系统提示词 *</Label>
            <Textarea
              value={form.systemPrompt}
              onChange={e => set('systemPrompt', e.target.value)}
              placeholder="定义 Agent 的行为、专长和约束..."
              className="min-h-[120px] font-mono text-sm"
            />
          </div>

          {/* Preferred Model */}
          <div className="space-y-1.5">
            <Label>首选模型</Label>
            <Select
              value={form.preferredModel || '__default__'}
              onValueChange={v => set('preferredModel', v === '__default__' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="使用默认模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">使用默认模型</SelectItem>
                {modelOptions.map(m => (
                  <SelectItem key={`${m.providerId}/${m.value}`} value={m.value}>
                    <span className="text-muted-foreground text-xs mr-1">[{m.providerName}]</span>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tool Permissions */}
          <div className="space-y-2">
            <Label>工具权限</Label>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={form.toolPermissions.read}
                  onCheckedChange={() => toggleTool('read')}
                />
                读取工作区
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={form.toolPermissions.write}
                  onCheckedChange={() => toggleTool('write')}
                />
                写入工作区
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={form.toolPermissions.exec}
                  onCheckedChange={() => toggleTool('exec')}
                />
                执行命令
              </label>
            </div>
          </div>

          {/* MCP Servers */}
          {mcpOptions.length > 0 && (
            <div className="space-y-2">
              <Label>MCP 服务器</Label>
              <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto border rounded-md p-2">
                {mcpOptions.map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={form.mcpServers.includes(s.id)}
                      onCheckedChange={() => toggleMcp(s.id)}
                    />
                    <span className="truncate">{s.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{s.scope}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !form.name.trim() || !form.responsibility.trim() || !form.systemPrompt.trim()}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
