'use client';

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WorkflowNode } from '@/lib/workflow/types-v3';

export interface WorkflowParamDef {
  name: string;
  type: string;
  description?: string;
}

export interface WorkflowStepEditorProps {
  node: WorkflowNode;
  workflowParams?: WorkflowParamDef[];
  onSave: (updated: WorkflowNode) => void;
  onCancel: () => void;
  onDelete?: (nodeId: string) => void;
}

export const NODE_TYPE_LABELS: Record<string, string> = {
  agent: 'Agent 节点',
  'if-else': '条件分支',
  'for-each': '循环遍历',
  while: '条件循环',
  notification: '通知',
  capability: '能力',
  wait: '等待',
  parallel: '并行',
  join: '汇合',
  approval: '人工审批',
};

export interface CommonStepFields {
  nodeId: string;
  timeoutMin: string;
  retryCount: string;
}

export interface CommonStepFieldSet extends CommonStepFields {
  setNodeId: Dispatch<SetStateAction<string>>;
  setTimeoutMin: Dispatch<SetStateAction<string>>;
  setRetryCount: Dispatch<SetStateAction<string>>;
}

export function useCommonStepFields(node: WorkflowNode): CommonStepFieldSet {
  const [nodeId, setNodeId] = useState(node.id);
  const [timeoutMin, setTimeoutMin] = useState(
    node.policy?.timeoutMs ? String(node.policy.timeoutMs / 60_000) : '10',
  );
  const [retryCount, setRetryCount] = useState(String(readPolicyRetry(node)));
  return { nodeId, setNodeId, timeoutMin, setTimeoutMin, retryCount, setRetryCount };
}

export function readNodeInput(node: WorkflowNode): Record<string, unknown> {
  if (node.type === 'join') return {};
  return (node.input ?? {}) as Record<string, unknown>;
}

function readPolicyRetry(node: WorkflowNode): number {
  const attempts = node.policy?.retry?.maximumAttempts;
  if (typeof attempts !== 'number' || attempts <= 1) return 0;
  return attempts - 1;
}

export function buildPolicy(
  node: WorkflowNode,
  timeoutMin: string,
  retryCount: string,
): WorkflowNode['policy'] | undefined {
  const policyBase = { ...(node.policy ?? {}) };
  const tMin = Number(timeoutMin);
  if (tMin > 0) policyBase.timeoutMs = Math.round(tMin * 60_000);
  const retries = Math.max(0, Math.floor(Number(retryCount) || 0));
  if (retries > 0) {
    policyBase.retry = { maximumAttempts: retries + 1 };
  } else {
    delete policyBase.retry;
  }
  return Object.keys(policyBase).length > 0 ? policyBase : undefined;
}

export function buildCommonNodePatch(
  node: WorkflowNode,
  fields: CommonStepFields,
): { id: string; policy?: WorkflowNode['policy'] } {
  const nextId = fields.nodeId.trim() || node.id;
  const policy = buildPolicy(node, fields.timeoutMin, fields.retryCount);
  return { id: nextId, ...(policy ? { policy } : {}) };
}

interface StepEditorFrameProps {
  node: WorkflowNode;
  children: ReactNode;
  onCancel: () => void;
  onDelete?: (nodeId: string) => void;
  onSave: () => void;
}

export function StepEditorFrame({
  node,
  children,
  onCancel,
  onDelete,
  onSave,
}: StepEditorFrameProps) {
  const typeLabel = NODE_TYPE_LABELS[node.type] || node.type;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-5 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">编辑节点</h3>
          <Badge variant="outline" className="text-[10px]">{typeLabel}</Badge>
        </div>
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm(`确认删除节点 "${node.id}"？`)) onDelete(node.id);
            }}
          >
            删除
          </Button>
        )}
      </div>

      {children}

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={onSave}>保存修改</Button>
      </div>
    </div>
  );
}

interface NodeIdFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function NodeIdField({ value, onChange }: NodeIdFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">节点 ID</Label>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-8 text-xs font-mono"
        placeholder="kebab-case"
      />
    </div>
  );
}

interface PolicyFieldsProps {
  timeoutMin: string;
  retryCount: string;
  onTimeoutChange: (value: string) => void;
  onRetryChange: (value: string) => void;
}

export function PolicyFields({
  timeoutMin,
  retryCount,
  onTimeoutChange,
  onRetryChange,
}: PolicyFieldsProps) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">超时（分钟）</Label>
        <Input
          type="number"
          value={timeoutMin}
          onChange={e => onTimeoutChange(e.target.value)}
          className="h-8 text-xs w-32"
          min={1}
          max={120}
          step={1}
        />
        <p className="text-[10px] text-muted-foreground">节点执行超时时间，默认 10 分钟</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">重试次数</Label>
        <Input
          type="number"
          value={retryCount}
          onChange={e => onRetryChange(e.target.value)}
          className="h-8 text-xs w-32"
          min={0}
          max={10}
          step={1}
        />
        <p className="text-[10px] text-muted-foreground">
          节点失败或验收不通过时重新执行的次数，默认 0（不重试）。重试之间有指数退避（1s/2s/4s…最多 30s）。
        </p>
      </div>
    </>
  );
}
