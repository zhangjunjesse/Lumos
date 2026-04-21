'use client';

import { useCallback, useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CodeModeEditor } from '../CodeModeEditor';
import {
  WorkflowKnowledgePanel,
  type WorkflowKnowledgeConfigDraft,
} from '../WorkflowKnowledgePanel';
import type { AgentNode } from '@/lib/workflow/types-v3';
import {
  buildCommonNodePatch,
  NodeIdField,
  PolicyFields,
  readNodeInput,
  StepEditorFrame,
  useCommonStepFields,
  type WorkflowStepEditorProps,
} from './step-editor-shared';
import {
  AgentCodeConfig,
  AgentPresetOption,
  buildAgentInput,
} from './agent-editor-helpers';

export function AgentEditor({
  node: rawNode,
  workflowParams = [],
  onSave,
  onCancel,
  onDelete,
}: WorkflowStepEditorProps) {
  const node = rawNode as AgentNode;
  const common = useCommonStepFields(node);
  const initialInput = readNodeInput(node);
  const [presets, setPresets] = useState<AgentPresetOption[]>([]);
  const [preset, setPreset] = useState(
    typeof initialInput.preset === 'string' ? initialInput.preset : '',
  );
  const [prompt, setPrompt] = useState(
    typeof initialInput.prompt === 'string' ? initialInput.prompt : '',
  );
  const [expectedOutput, setExpectedOutput] = useState(
    typeof initialInput.expectedOutput === 'string' ? initialInput.expectedOutput : '',
  );
  const initCode = initialInput.code as AgentCodeConfig | undefined;
  const [codeEnabled, setCodeEnabled] = useState(Boolean(initCode?.script || initCode?.handler));
  const [codeScript, setCodeScript] = useState(initCode?.script ?? '');
  const [codeStrategy, setCodeStrategy] = useState(initCode?.strategy ?? 'code-first');
  const initKnowledge = initialInput.knowledge as WorkflowKnowledgeConfigDraft | undefined;
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

  const handleSave = useCallback(() => {
    onSave({
      ...node,
      ...buildCommonNodePatch(node, common),
      input: buildAgentInput(
        node,
        preset,
        prompt,
        expectedOutput,
        codeEnabled,
        codeScript,
        codeStrategy,
        knowledge,
      ),
    });
  }, [codeEnabled, codeScript, codeStrategy, common, expectedOutput, knowledge, node, onSave, preset, prompt]);

  const selectedPreset = presets.find(p => p.id === preset);

  return (
    <StepEditorFrame node={node} onCancel={onCancel} onDelete={onDelete} onSave={handleSave}>
      <NodeIdField value={common.nodeId} onChange={common.setNodeId} />

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
          placeholder={'描述"怎样算这一步做完了"，判分老师只读这段文字。\n留空则跳过判分，直接信任执行结果。'}
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
        stepId={node.id}
        onEnabledChange={setCodeEnabled}
        onScriptChange={setCodeScript}
        onStrategyChange={setCodeStrategy}
      />

      <WorkflowKnowledgePanel value={knowledge} onChange={setKnowledge} />

      <PolicyFields
        timeoutMin={common.timeoutMin}
        retryCount={common.retryCount}
        onTimeoutChange={common.setTimeoutMin}
        onRetryChange={common.setRetryCount}
      />
    </StepEditorFrame>
  );
}
