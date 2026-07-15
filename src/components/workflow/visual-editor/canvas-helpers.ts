import type { WorkflowDSLV3, WorkflowNode, WorkflowNodeType } from '@/lib/workflow/types-v3';

/**
 * Canvas 对外的 DSL 形状 —— 直接复用 V3 DSL,
 * 不再保留编辑器旧的 steps/dependsOn 影子模型。
 */
export type DslSpec = WorkflowDSLV3;

export function genId(type: string): string {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

type NewNodeSeed = Omit<WorkflowNode, 'id'>;

/**
 * 画布拖拽创建节点时的默认骨架 (input 默认值 / 默认 policy)。
 * 返回值不含 id —— 调用方通过 `genId(type)` 生成并补齐。
 */
export function defaultNodeForType(type: WorkflowNodeType): NewNodeSeed {
  switch (type) {
    case 'agent':
      return { type: 'agent', input: { prompt: '', role: 'worker' } };
    case 'team':
      return { type: 'team', input: { teamId: '', task: '' } };
    case 'if-else':
      return {
        type: 'if-else',
        input: { condition: { op: 'exists', ref: 'input.flag' } as never },
      };
    case 'for-each':
      return {
        type: 'for-each',
        input: { collection: 'input.items', itemVar: 'item' },
      };
    case 'while':
      return {
        type: 'while',
        input: { condition: { op: 'exists', ref: 'input.hasMore' } as never, maxIterations: 20 },
      };
    case 'wait':
      return { type: 'wait', input: { durationMs: 5000 } };
    case 'notification':
      return { type: 'notification', input: {} };
    case 'capability':
      return { type: 'capability', input: {} };
    case 'parallel':
      return { type: 'parallel', input: { onBranchFail: 'wait-all' } };
    case 'join':
      return { type: 'join', input: {} };
    case 'approval':
      return {
        type: 'approval',
        input: {
          prompt: '请审批这一步',
          approvers: { mode: 'any', users: [] },
        },
      };
  }
}
