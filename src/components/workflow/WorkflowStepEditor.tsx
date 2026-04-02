'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DslStep {
  id: string;
  type: string;
  dependsOn?: string[];
  when?: Record<string, unknown>;
  input?: Record<string, unknown>;
  policy?: { timeoutMs?: number; retry?: { maximumAttempts?: number } };
}

interface AgentPresetOption {
  id: string;
  name: string;
  description?: string;
}

interface WorkflowParamDef {
  name: string;
  type: string;
  description?: string;
}

interface WorkflowStepEditorProps {
  step: DslStep;
  allStepIds: string[];
  workflowParams?: WorkflowParamDef[];
  onSave: (updated: DslStep) => void;
  onCancel: () => void;
  onDelete?: (stepId: string) => void;
}

const STEP_TYPE_LABELS: Record<string, string> = {
  agent: 'Agent 步骤',
  'if-else': '条件分支',
  'for-each': '循环遍历',
  while: '条件循环',
  notification: '通知',
  capability: '能力',
};

const CODE_STRATEGY_LABELS: Record<string, string> = {
  'code-first': '代码优先（失败回退 Agent）',
  'code-only': '仅代码',
  'agent-only': '仅 Agent',
};

export function WorkflowStepEditor({
  step,
  allStepIds,
  workflowParams = [],
  onSave,
  onCancel,
  onDelete,
}: WorkflowStepEditorProps) {
  const [presets, setPresets] = useState<AgentPresetOption[]>([]);
  const [preset, setPreset] = useState(
    typeof step.input?.preset === 'string' ? step.input.preset : '',
  );
  const [prompt, setPrompt] = useState(
    typeof step.input?.prompt === 'string' ? step.input.prompt : '',
  );
  const [dependsOn, setDependsOn] = useState(
    (step.dependsOn ?? []).join(', '),
  );
  const [stepId, setStepId] = useState(step.id);

  // Control flow fields
  const [thenSteps, setThenSteps] = useState(
    Array.isArray(step.input?.then) ? (step.input.then as string[]).join(', ') : '',
  );
  const [elseSteps, setElseSteps] = useState(
    Array.isArray(step.input?.else) ? (step.input.else as string[]).join(', ') : '',
  );
  const [bodySteps, setBodySteps] = useState(
    Array.isArray(step.input?.body) ? (step.input.body as string[]).join(', ') : '',
  );
  const [collection, setCollection] = useState(
    typeof step.input?.collection === 'string' ? step.input.collection : '',
  );
  const [itemVar, setItemVar] = useState(
    typeof step.input?.itemVar === 'string' ? step.input.itemVar : 'item',
  );
  const [maxIterations, setMaxIterations] = useState(
    typeof step.input?.maxIterations === 'number' ? String(step.input.maxIterations) : '',
  );
  const [conditionJson, setConditionJson] = useState(
    step.input?.condition ? JSON.stringify(step.input.condition, null, 2) : '',
  );
  const [timeoutMin, setTimeoutMin] = useState(
    step.policy?.timeoutMs ? String(step.policy.timeoutMs / 60_000) : '10',
  );
  const initCode = step.input?.code as { handler?: string; strategy?: string } | undefined;
  const [codeEnabled, setCodeEnabled] = useState(Boolean(initCode?.handler));
  const [codeHandler, setCodeHandler] = useState(initCode?.handler ?? '');
  const [codeStrategy, setCodeStrategy] = useState(initCode?.strategy ?? 'code-first');

  useEffect(() => {
    fetch('/api/workflow/agent-presets')
      .then(r => r.json())
      .then((data: { presets?: AgentPresetOption[] }) => {
        setPresets(data.presets ?? []);
      })
      .catch(() => {});
  }, []);

  const parseCommaSep = (s: string): string[] =>
    s.split(',').map(v => v.trim()).filter(Boolean);

  const handleSave = useCallback(() => {
    const deps = parseCommaSep(dependsOn);
    const base: DslStep = {
      id: stepId.trim() || step.id,
      type: step.type,
      ...(deps.length > 0 ? { dependsOn: deps } : {}),
    };

    if (step.type === 'agent') {
      const input: Record<string, unknown> = { ...step.input };
      if (preset) input.preset = preset;
      if (prompt) input.prompt = prompt;
      if (codeEnabled && codeHandler.trim()) {
        input.code = { handler: codeHandler.trim(), strategy: codeStrategy };
      } else {
        delete input.code;
      }
      base.input = input;
    } else if (step.type === 'if-else') {
      let condition: unknown = step.input?.condition;
      try { if (conditionJson.trim()) condition = JSON.parse(conditionJson); } catch { /* keep */ }
      base.input = {
        condition,
        then: parseCommaSep(thenSteps),
        ...(elseSteps.trim() ? { else: parseCommaSep(elseSteps) } : {}),
      };
    } else if (step.type === 'for-each') {
      base.input = {
        collection,
        itemVar: itemVar || 'item',
        body: parseCommaSep(bodySteps),
        ...(maxIterations ? { maxIterations: Number(maxIterations) } : {}),
      };
    } else if (step.type === 'while') {
      let condition: unknown = step.input?.condition;
      try { if (conditionJson.trim()) condition = JSON.parse(conditionJson); } catch { /* keep */ }
      base.input = {
        condition,
        body: parseCommaSep(bodySteps),
        ...(maxIterations ? { maxIterations: Number(maxIterations) } : {}),
      };
    } else {
      base.input = step.input;
    }

    if (step.when) base.when = step.when;
    const tMin = Number(timeoutMin);
    if (tMin > 0) {
      base.policy = { ...step.policy, timeoutMs: Math.round(tMin * 60_000) };
    } else if (step.policy) {
      base.policy = step.policy;
    }
    onSave(base);
  }, [
    step, stepId, preset, prompt, dependsOn,
    thenSteps, elseSteps, bodySteps, collection, itemVar,
    maxIterations, conditionJson, timeoutMin, onSave,
    codeEnabled, codeHandler, codeStrategy,
  ]);

  const otherStepIds = allStepIds.filter(id => id !== step.id);
  const typeLabel = STEP_TYPE_LABELS[step.type] || step.type;
  const selectedPreset = presets.find(p => p.id === preset);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-5 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">编辑步骤</h3>
          <Badge variant="outline" className="text-[10px]">{typeLabel}</Badge>
        </div>
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
            onClick={() => { if (confirm(`确认删除步骤 "${step.id}"？`)) onDelete(step.id); }}
          >
            删除
          </Button>
        )}
      </div>

      {/* Step ID */}
      <div className="space-y-1.5">
        <Label className="text-xs">步骤 ID</Label>
        <Input
          value={stepId}
          onChange={e => setStepId(e.target.value)}
          className="h-8 text-xs font-mono"
          placeholder="kebab-case"
        />
      </div>

      {/* Dependencies */}
      <div className="space-y-1.5">
        <Label className="text-xs">依赖步骤（逗号分隔）</Label>
        <Input
          value={dependsOn}
          onChange={e => setDependsOn(e.target.value)}
          className="h-8 text-xs font-mono"
          placeholder={otherStepIds.join(', ') || '无'}
        />
      </div>

      {/* Agent-specific fields */}
      {step.type === 'agent' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Agent</Label>
            <Select value={preset || '__none__'} onValueChange={v => setPreset(v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="选择 Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">未选择</SelectItem>
                {presets.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPreset?.description && (
              <p className="text-[10px] text-muted-foreground">{selectedPreset.description}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">任务 Prompt</Label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="min-h-[80px] text-xs"
              placeholder="描述此步骤的具体任务..."
            />
            {workflowParams.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                可用参数（用 <code className="bg-muted px-1 rounded">{'{{'}input.参数名{'}}'}</code> 插入）：{workflowParams.map(p => (
                  <code key={p.name} className="bg-muted px-1 rounded mr-1">
                    {'{{'}input.{p.name}{'}}'}
                  </code>
                ))}
              </p>
            )}
          </div>

          {/* Code mode */}
          <div className="space-y-2 border-t border-border/40 pt-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">代码模式</Label>
              <div className="flex items-center gap-1.5">
                {codeEnabled && <Badge variant="outline" className="text-[9px] h-4 px-1">已启用</Badge>}
                <button
                  type="button"
                  onClick={() => setCodeEnabled(v => !v)}
                  className="text-xs text-primary hover:underline"
                >
                  {codeEnabled ? '关闭' : '启用'}
                </button>
              </div>
            </div>
            {codeEnabled && (
              <div className="space-y-2 pl-1">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Handler ID</Label>
                  <Input
                    value={codeHandler}
                    onChange={e => setCodeHandler(e.target.value)}
                    className="h-7 text-xs font-mono"
                    placeholder="e.g. cross-border/download"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">执行策略</Label>
                  <Select value={codeStrategy} onValueChange={setCodeStrategy}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CODE_STRATEGY_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* If-Else fields */}
      {step.type === 'if-else' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">条件（JSON）</Label>
            <Textarea
              value={conditionJson}
              onChange={e => setConditionJson(e.target.value)}
              className="min-h-[60px] text-xs font-mono"
              placeholder='{"op": "gt", "left": "steps.xxx.output.count", "right": 5}'
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Then 步骤（逗号分隔）</Label>
            <Input value={thenSteps} onChange={e => setThenSteps(e.target.value)} className="h-8 text-xs font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Else 步骤（逗号分隔，可选）</Label>
            <Input value={elseSteps} onChange={e => setElseSteps(e.target.value)} className="h-8 text-xs font-mono" />
          </div>
        </>
      )}

      {/* For-Each fields */}
      {step.type === 'for-each' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">集合引用</Label>
            <Input value={collection} onChange={e => setCollection(e.target.value)} className="h-8 text-xs font-mono" placeholder="steps.xxx.output.items" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">迭代变量名</Label>
            <Input value={itemVar} onChange={e => setItemVar(e.target.value)} className="h-8 text-xs font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">循环体步骤（逗号分隔）</Label>
            <Input value={bodySteps} onChange={e => setBodySteps(e.target.value)} className="h-8 text-xs font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">最大迭代次数（可选）</Label>
            <Input value={maxIterations} onChange={e => setMaxIterations(e.target.value)} className="h-8 text-xs font-mono" placeholder="50" type="number" />
          </div>
        </>
      )}

      {/* While fields */}
      {step.type === 'while' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">条件（JSON）</Label>
            <Textarea
              value={conditionJson}
              onChange={e => setConditionJson(e.target.value)}
              className="min-h-[60px] text-xs font-mono"
              placeholder='{"op": "exists", "ref": "steps.xxx.output.hasMore"}'
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">循环体步骤（逗号分隔）</Label>
            <Input value={bodySteps} onChange={e => setBodySteps(e.target.value)} className="h-8 text-xs font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">最大迭代次数（可选）</Label>
            <Input value={maxIterations} onChange={e => setMaxIterations(e.target.value)} className="h-8 text-xs font-mono" placeholder="20" type="number" />
          </div>
        </>
      )}

      {/* Timeout */}
      <div className="space-y-1.5">
        <Label className="text-xs">超时（分钟）</Label>
        <Input
          type="number"
          value={timeoutMin}
          onChange={e => setTimeoutMin(e.target.value)}
          className="h-8 text-xs w-32"
          min={1}
          max={120}
          step={1}
        />
        <p className="text-[10px] text-muted-foreground">节点执行超时时间，默认 10 分钟</p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={handleSave}>保存修改</Button>
      </div>
    </div>
  );
}
