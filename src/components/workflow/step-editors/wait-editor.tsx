'use client';

import { useCallback, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { WaitNode } from '@/lib/workflow/types-v3';
import {
  buildCommonNodePatch,
  NodeIdField,
  PolicyFields,
  readNodeInput,
  StepEditorFrame,
  useCommonStepFields,
  type WorkflowStepEditorProps,
} from './step-editor-shared';

export function WaitEditor({ node: rawNode, onSave, onCancel, onDelete }: WorkflowStepEditorProps) {
  const node = rawNode as WaitNode;
  const common = useCommonStepFields(node);
  const initialInput = readNodeInput(node);
  const [durationMs, setDurationMs] = useState(
    typeof initialInput.durationMs === 'number' ? String(initialInput.durationMs) : '5000',
  );

  const handleSave = useCallback(() => {
    const ms = Number(durationMs);
    onSave({
      ...node,
      ...buildCommonNodePatch(node, common),
      input: { durationMs: Number.isFinite(ms) ? ms : 0 },
    });
  }, [common, durationMs, node, onSave]);

  return (
    <StepEditorFrame node={node} onCancel={onCancel} onDelete={onDelete} onSave={handleSave}>
      <NodeIdField value={common.nodeId} onChange={common.setNodeId} />

      <div className="space-y-1.5">
        <Label className="text-xs">等待时长（毫秒）</Label>
        <Input
          type="number"
          value={durationMs}
          onChange={e => setDurationMs(e.target.value)}
          className="h-8 text-xs w-40"
          min={0}
          max={3600000}
        />
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
