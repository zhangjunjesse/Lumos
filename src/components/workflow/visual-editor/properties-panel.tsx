'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';

interface AgentPreset { id: string; name: string; description?: string }

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

  useEffect(() => {
    setInput(data.input);
    setStepId(data.stepId);
    setDeps(data.dependsOn.join(', '));
  }, [data]);

  useEffect(() => {
    fetch('/api/workflow/agent-presets')
      .then(r => r.json())
      .then((d: { presets?: AgentPreset[] }) => setPresets(d.presets ?? []))
      .catch(() => {});
  }, []);

  const save = useCallback(() => {
    const newDeps = deps.split(',').map(s => s.trim()).filter(Boolean);
    onUpdate({ ...data, stepId, input, dependsOn: newDeps });
  }, [data, stepId, input, deps, onUpdate]);

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

      <div className="flex gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={save}>保存</Button>
        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={onDelete}>删除</Button>
      </div>
    </div>
  );
}
