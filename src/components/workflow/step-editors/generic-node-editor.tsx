'use client';

import { useCallback } from 'react';
import type {
  ApprovalNode,
  CapabilityNode,
  JoinNode,
  NotificationNode,
  ParallelNode,
} from '@/lib/workflow/types-v3';
import {
  buildCommonNodePatch,
  NodeIdField,
  PolicyFields,
  StepEditorFrame,
  useCommonStepFields,
  type WorkflowStepEditorProps,
} from './step-editor-shared';

type GenericEditableNode =
  | NotificationNode
  | CapabilityNode
  | ApprovalNode
  | ParallelNode
  | JoinNode;

export function GenericNodeEditor({
  node: rawNode,
  onSave,
  onCancel,
  onDelete,
}: WorkflowStepEditorProps) {
  const node = rawNode as GenericEditableNode;
  const common = useCommonStepFields(node);

  const handleSave = useCallback(() => {
    onSave({
      ...node,
      ...buildCommonNodePatch(node, common),
    });
  }, [common, node, onSave]);

  return (
    <StepEditorFrame node={node} onCancel={onCancel} onDelete={onDelete} onSave={handleSave}>
      <NodeIdField value={common.nodeId} onChange={common.setNodeId} />
      <PolicyFields
        timeoutMin={common.timeoutMin}
        retryCount={common.retryCount}
        onTimeoutChange={common.setTimeoutMin}
        onRetryChange={common.setRetryCount}
      />
    </StepEditorFrame>
  );
}
