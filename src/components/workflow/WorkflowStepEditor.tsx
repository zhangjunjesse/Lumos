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
import { CodeModeEditor } from './CodeModeEditor';
import { WorkflowKnowledgePanel, type WorkflowKnowledgeConfigDraft } from './WorkflowKnowledgePanel';

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
  const [expectedOutput, setExpectedOutput] = useState(
    typeof step.input?.expectedOutput === 'string' ? step.input.expectedOutput : '',
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
  // 用户视角：0 次 = 不重试（底层 maximumAttempts=1 或未设置）；N 次 = 底层 maximumAttempts=N+1
  const [retryCount, setRetryCount] = useState(() => {
    const attempts = step.policy?.retry?.maximumAttempts;
    if (typeof attempts !== 'number' || attempts <= 1) return '0';
    return String(attempts - 1);
  });
  const initCode = step.input?.code as { handler?: string; script?: string; strategy?: string } | undefined;
  const [codeEnabled, setCodeEnabled] = useState(Boolean(initCode?.script || initCode?.handler));
  const [codeScript, setCodeScript] = useState(initCode?.script ?? '');
  const [codeStrategy, setCodeStrategy] = useState(initCode?.strategy ?? 'code-first');

  const initKnowledge = step.input?.knowledge as WorkflowKnowledgeConfigDraft | undefined;
  const [knowledge, setKnowledge] = useState<WorkflowKnowledgeConfigDraft>({
    enabled: Boolean(initKnowledge?.enabled),
    defaultTagNames: Array.isArray(initKnowledge?.defaultTagNames) ? initKnowledge.defaultTagNames : [],
    allowAgentTagSelection: initKnowledge?.allowAgentTagSelection ?? true,
    topK: typeof initKnowledge?.topK === 'number' ? initKnowledge.topK : undefined,
  });

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
      const trimmedExpected = expectedOutput.trim();
      if (trimmedExpected) {
        input.expectedOutput = trimmedExpected;
      } else {
        delete input.expectedOutput;
      }
      if (codeEnabled && codeScript.trim()) {
        input.code = { script: codeScript, strategy: codeStrategy };
      } else {
        delete input.code;
      }
      if (knowledge.enabled) {
        input.knowledge = {
          enabled: true,
          defaultTagNames: knowledge.defaultTagNames,
          allowAgentTagSelection: knowledge.allowAgentTagSelection,
          ...(typeof knowledge.topK === 'number' ? { topK: knowledge.topK } : {}),
        };
      } else {
        delete input.knowledge;
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
    const retries = Math.max(0, Math.floor(Number(retryCount) || 0));
    const nextPolicy: NonNullable<DslStep['policy']> = { ...step.policy };
    if (tMin > 0) nextPolicy.timeoutMs = Math.round(tMin * 60_000);
    if (retries > 0) {
      nextPolicy.retry = { maximumAttempts: retries + 1 };
    } else {
      delete nextPolicy.retry;
    }
    if (Object.keys(nextPolicy).length > 0) base.policy = nextPolicy;
    onSave(base);
  }, [
    step, stepId, preset, prompt, expectedOutput, dependsOn,
    thenSteps, elseSteps, bodySteps, collection, itemVar,
    maxIterations, conditionJson, timeoutMin, retryCount, onSave,
    codeEnabled, codeScript, codeStrategy,
    knowledge,
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

          <div className="space-y-1.5">
            <Label className="text-xs">验收说明（可选）</Label>
            <Textarea
              value={expectedOutput}
              onChange={e => setExpectedOutput(e.target.value)}
              className="min-h-[60px] text-xs"
              placeholder={'描述"怎样算这一步做完了"，判分老师只读这段文字。\n留空则跳过判分，直接信任执行结果。\n例：必须调用 generate_image 工具生成至少一张图片\n例：纯文本分析任务，不需要调用任何工具'}
            />
            <p className="text-[10px] text-muted-foreground">
              留空 = 跳过判分。填了 = 判分老师会拿这段话对照 agent 输出和工具调用事实来打分。
            </p>
          </div>

          <CodeModeEditor
            enabled={codeEnabled}
            script={codeScript}
            strategy={codeStrategy}
            prompt={prompt}
            stepId={step.id}
            onEnabledChange={setCodeEnabled}
            onScriptChange={setCodeScript}
            onStrategyChange={setCodeStrategy}
          />

          <WorkflowKnowledgePanel
            value={knowledge}
            onChange={setKnowledge}
          />
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

      {/* Retry */}
      <div className="space-y-1.5">
        <Label className="text-xs">重试次数</Label>
        <Input
          type="number"
          value={retryCount}
          onChange={e => setRetryCount(e.target.value)}
          className="h-8 text-xs w-32"
          min={0}
          max={10}
          step={1}
        />
        <p className="text-[10px] text-muted-foreground">
          节点失败或验收不通过时重新执行的次数，默认 0（不重试）。重试之间有指数退避（1s/2s/4s…最多 30s）。
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={handleSave}>保存修改</Button>
      </div>
    </div>
  );
}
