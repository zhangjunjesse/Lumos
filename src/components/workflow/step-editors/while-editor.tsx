'use client';

import { useCallback, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { WhileNode } from '@/lib/workflow/types-v3';
import {
  buildCommonNodePatch,
  NodeIdField,
  PolicyFields,
  readNodeInput,
  StepEditorFrame,
  useCommonStepFields,
  type WorkflowStepEditorProps,
} from './step-editor-shared';

function parseCondition(conditionJson: string, fallback: unknown): unknown {
  try {
    if (conditionJson.trim()) return JSON.parse(conditionJson);
  } catch {
    return fallback;
  }
  return fallback;
}

export function WhileEditor({ node: rawNode, onSave, onCancel, onDelete }: WorkflowStepEditorProps) {
  const node = rawNode as WhileNode;
  const common = useCommonStepFields(node);
  const initialInput = readNodeInput(node);
  const [conditionJson, setConditionJson] = useState(
    initialInput.condition ? JSON.stringify(initialInput.condition, null, 2) : '',
  );
  const [maxIterations, setMaxIterations] = useState(
    typeof initialInput.maxIterations === 'number' ? String(initialInput.maxIterations) : '',
  );

  const handleSave = useCallback(() => {
    const condition = parseCondition(conditionJson, initialInput.condition);
    onSave({
      ...node,
      ...buildCommonNodePatch(node, common),
      input: {
        condition: condition as never,
        ...(maxIterations ? { maxIterations: Number(maxIterations) } : {}),
        ...(initialInput.mode === 'do-while' ? { mode: 'do-while' as const } : {}),
        ...(initialInput.state ? { state: initialInput.state as never } : {}),
      },
    });
  }, [common, conditionJson, initialInput.condition, initialInput.mode, initialInput.state, maxIterations, node, onSave]);

  return (
    <StepEditorFrame node={node} onCancel={onCancel} onDelete={onDelete} onSave={handleSave}>
      <NodeIdField value={common.nodeId} onChange={common.setNodeId} />

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
        <Label className="text-xs">最大迭代次数（可选）</Label>
        <Input
          value={maxIterations}
          onChange={e => setMaxIterations(e.target.value)}
          className="h-8 text-xs font-mono"
          placeholder="20"
          type="number"
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        循环体节点通过可视化编辑器中的 body 边管理,不在此编辑。
      </p>

      <PolicyFields
        timeoutMin={common.timeoutMin}
        retryCount={common.retryCount}
        onTimeoutChange={common.setTimeoutMin}
        onRetryChange={common.setRetryCount}
      />
    </StepEditorFrame>
  );
}
