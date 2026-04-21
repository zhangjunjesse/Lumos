'use client';

import { useCallback, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { IfElseNode } from '@/lib/workflow/types-v3';
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

export function IfElseEditor({ node: rawNode, onSave, onCancel, onDelete }: WorkflowStepEditorProps) {
  const node = rawNode as IfElseNode;
  const common = useCommonStepFields(node);
  const initialInput = readNodeInput(node);
  const [conditionJson, setConditionJson] = useState(
    initialInput.condition ? JSON.stringify(initialInput.condition, null, 2) : '',
  );

  const handleSave = useCallback(() => {
    onSave({
      ...node,
      ...buildCommonNodePatch(node, common),
      input: {
        condition: parseCondition(conditionJson, initialInput.condition) as never,
      },
    });
  }, [common, conditionJson, initialInput.condition, node, onSave]);

  return (
    <StepEditorFrame node={node} onCancel={onCancel} onDelete={onDelete} onSave={handleSave}>
      <NodeIdField value={common.nodeId} onChange={common.setNodeId} />

      <div className="space-y-1.5">
        <Label className="text-xs">条件（JSON）</Label>
        <Textarea
          value={conditionJson}
          onChange={e => setConditionJson(e.target.value)}
          className="min-h-[60px] text-xs font-mono"
          placeholder='{"op": "gt", "left": "steps.xxx.output.count", "right": 5}'
        />
        <p className="text-[10px] text-muted-foreground">
          分支关系通过可视化编辑器中的 then/else 边管理,不在此编辑。
        </p>
      </div>

      <PolicyFields
        timeoutMin={common.timeoutMin}
        retryCount={common.retryCount}
        onTimeoutChange={common.setTimeoutMin}
        onRetryChange={common.setRetryCount}
      />
    </StepEditorFrame>
  );
}
