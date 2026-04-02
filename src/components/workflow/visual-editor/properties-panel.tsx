'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';

interface AgentPreset { id: string; name: string; description?: string }

interface CodeConfig {
  handler?: string;
  params?: Record<string, unknown>;
  strategy?: 'code-only' | 'code-first' | 'agent-only';
}

const STRATEGY_LABELS: Record<string, string> = {
  'code-first': '代码优先（失败回退 Agent）',
  'code-only': '仅代码',
  'agent-only': '仅 Agent',
};

function CodeModeSection({ input, updateInput }: {
  input: Record<string, unknown>;
  updateInput: (key: string, value: unknown) => void;
}) {
  const code = (input.code ?? null) as CodeConfig | null;
  const hasCode = Boolean(code?.handler);

  function toggleCode() {
    if (hasCode) {
      updateInput('code', undefined);
    } else {
      updateInput('code', { handler: '', strategy: 'code-first' });
    }
  }

  return (
    <div className="space-y-1.5 pt-1 border-t border-border/30">
      <div className="flex items-center justify-between">
        <Label className="text-[10px]">代码模式</Label>
        <div className="flex items-center gap-1">
          {hasCode && <Badge variant="outline" className="text-[8px] h-4 px-1">已启用</Badge>}
          <button onClick={toggleCode} className="text-[10px] text-primary hover:underline">
            {hasCode ? '关闭' : '启用'}
          </button>
        </div>
      </div>
      {hasCode && code && (
        <div className="space-y-1.5">
          <div className="space-y-1">
            <Label className="text-[9px] text-muted-foreground">Handler ID</Label>
            <Input
              value={code.handler || ''}
              onChange={e => updateInput('code', { ...code, handler: e.target.value })}
              className="h-6 text-[10px] font-mono"
              placeholder="e.g. cross-border/download"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[9px] text-muted-foreground">执行策略</Label>
            <Select
              value={code.strategy || 'code-first'}
              onValueChange={v => updateInput('code', { ...code, strategy: v })}
            >
              <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

interface PropertiesPanelProps {
  data: StepNodeData;
  allStepIds: string[];
  onUpdate: (data: StepNodeData) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function PropertiesPanel({ data, allStepIds, onUpdate, onDelete, onClose }: PropertiesPanelProps) {
  const [input, setInput] = useState(data.input);
  const [stepId, setStepId] = useState(data.stepId);
  const [deps, setDeps] = useState(data.dependsOn.join(', '));
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const defaultTimeoutMin = 10;
  const [timeoutMin, setTimeoutMin] = useState(
    data.policy?.timeoutMs ? data.policy.timeoutMs / 60_000 : defaultTimeoutMin,
  );

  // Sync local state when data prop changes (React recommended pattern: adjust state during render)
  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    setInput(data.input);
    setStepId(data.stepId);
    setDeps(data.dependsOn.join(', '));
    setTimeoutMin(data.policy?.timeoutMs ? data.policy.timeoutMs / 60_000 : defaultTimeoutMin);
  }

  useEffect(() => {
    fetch('/api/workflow/agent-presets')
      .then(r => r.json())
      .then((d: { presets?: AgentPreset[] }) => setPresets(d.presets ?? []))
      .catch(() => {});
  }, []);

  const save = useCallback(() => {
    const newDeps = deps.split(',').map(s => s.trim()).filter(Boolean);
    const timeoutMs = timeoutMin > 0 ? Math.round(timeoutMin * 60_000) : undefined;
    const policy = timeoutMs ? { ...data.policy, timeoutMs } : data.policy;
    onUpdate({ ...data, stepId, input, dependsOn: newDeps, policy });
  }, [data, stepId, input, deps, timeoutMin, onUpdate]);

  const updateInput = useCallback((key: string, value: unknown) => {
    setInput(prev => ({ ...prev, [key]: value }));
  }, []);

  const otherIds = allStepIds.filter(id => id !== data.stepId);
  const currentPreset = typeof input.preset === 'string' ? input.preset : '';

  return (
    <div className="w-56 shrink-0 border-l border-border/40 bg-muted/20 p-3 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">属性</span>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">x</button>
      </div>

      <div className="space-y-1">
        <Label className="text-[10px]">ID</Label>
        <Input value={stepId} onChange={e => setStepId(e.target.value)} className="h-7 text-xs font-mono" />
      </div>

      <div className="space-y-1">
        <Label className="text-[10px]">依赖</Label>
        <Input value={deps} onChange={e => setDeps(e.target.value)} className="h-7 text-xs font-mono" placeholder={otherIds.join(', ') || '无'} />
      </div>

      {data.stepType === 'agent' && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px]">Agent</Label>
            <Select value={currentPreset || '__none__'} onValueChange={v => updateInput('preset', v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="选择 Agent" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">未选择</SelectItem>
                {presets.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Prompt</Label>
            <Textarea
              value={typeof input.prompt === 'string' ? input.prompt : ''}
              onChange={e => updateInput('prompt', e.target.value)}
              className="min-h-[50px] text-xs"
            />
          </div>
          <CodeModeSection input={input} updateInput={updateInput} />
        </>
      )}

      {data.stepType === 'if-else' && (
        <div className="space-y-1">
          <Label className="text-[10px]">条件 (JSON)</Label>
          <Textarea
            value={input.condition ? JSON.stringify(input.condition, null, 2) : ''}
            onChange={e => { try { updateInput('condition', JSON.parse(e.target.value)); } catch { /* typing */ } }}
            className="min-h-[40px] text-xs font-mono"
          />
        </div>
      )}

      {data.stepType === 'for-each' && (
        <div className="space-y-1">
          <Label className="text-[10px]">集合引用</Label>
          <Input
            value={typeof input.collection === 'string' ? input.collection : ''}
            onChange={e => updateInput('collection', e.target.value)}
            className="h-7 text-xs font-mono"
          />
        </div>
      )}

      {data.stepType === 'wait' && (
        <div className="space-y-1">
          <Label className="text-[10px]">等待时长（毫秒）</Label>
          <Input
            type="number"
            value={typeof input.durationMs === 'number' ? input.durationMs : 5000}
            onChange={e => updateInput('durationMs', Number(e.target.value))}
            className="h-7 text-xs"
            min={0}
            max={3600000}
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-[10px]">超时（分钟）</Label>
        <Input
          type="number"
          value={timeoutMin}
          onChange={e => setTimeoutMin(Number(e.target.value))}
          className="h-7 text-xs"
          min={1}
          max={120}
          step={1}
        />
        <p className="text-[9px] text-muted-foreground">节点执行超时时间，默认 10 分钟</p>
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={save}>保存</Button>
        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={onDelete}>删除</Button>
      </div>
    </div>
  );
}
