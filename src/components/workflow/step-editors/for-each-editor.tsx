'use client';

import { useCallback, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { ForEachNode } from '@/lib/workflow/types-v3';
import {
  buildCommonNodePatch,
  NodeIdField,
  PolicyFields,
  readNodeInput,
  StepEditorFrame,
  useCommonStepFields,
  type WorkflowStepEditorProps,
} from './step-editor-shared';

export function ForEachEditor({ node: rawNode, onSave, onCancel, onDelete }: WorkflowStepEditorProps) {
  const node = rawNode as ForEachNode;
  const common = useCommonStepFields(node);
  const initialInput = readNodeInput(node);
  const [collection, setCollection] = useState(
    typeof initialInput.collection === 'string' ? initialInput.collection : '',
  );
  const [itemVar, setItemVar] = useState(
    typeof initialInput.itemVar === 'string' ? initialInput.itemVar : 'item',
  );
  const [maxIterations, setMaxIterations] = useState(
    typeof initialInput.maxIterations === 'number' ? String(initialInput.maxIterations) : '',
  );

  const handleSave = useCallback(() => {
    onSave({
      ...node,
      ...buildCommonNodePatch(node, common),
      input: {
        collection,
        itemVar: itemVar || 'item',
        ...(maxIterations ? { maxIterations: Number(maxIterations) } : {}),
      },
    });
  }, [collection, common, itemVar, maxIterations, node, onSave]);

  return (
    <StepEditorFrame node={node} onCancel={onCancel} onDelete={onDelete} onSave={handleSave}>
      <NodeIdField value={common.nodeId} onChange={common.setNodeId} />

      <div className="space-y-1.5">
        <Label className="text-xs">集合引用</Label>
        <Input
          value={collection}
          onChange={e => setCollection(e.target.value)}
          className="h-8 text-xs font-mono"
          placeholder="steps.xxx.output.items"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">迭代变量名</Label>
        <Input
          value={itemVar}
          onChange={e => setItemVar(e.target.value)}
          className="h-8 text-xs font-mono"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">最大迭代次数（可选）</Label>
        <Input
          value={maxIterations}
          onChange={e => setMaxIterations(e.target.value)}
          className="h-8 text-xs font-mono"
          placeholder="50"
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
