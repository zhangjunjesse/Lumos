import type {
  ConditionExpr,
  WorkflowParamDef,
  WorkflowStepMetadata,
  WorkflowStepPolicy,
} from './types';

// ── Edges (一等公民) ────────────────────────────────────────────────────────
//
// 每种 EdgeKind 对应唯一语义。执行顺序图里"下一步去哪"由 edges 完全决定,
// 节点本身不再携带 then/else/body 等分支数组。

export type EdgeKind = 'next' | 'then' | 'else' | 'body' | 'on-error';

export interface WorkflowEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** parallel 节点分支顺序 (0-based). 仅 kind='next' 且 from 为 parallel 时有意义. */
  branchIndex?: number;
}

// ── Per-node error handling ─────────────────────────────────────────────────
//
// retry 先耗尽, 再评估 action。action='goto' 时必须有同节点的 on-error 出边
// 指向 target。

export interface NodeOnError {
  action: 'fail' | 'continue' | 'goto';
  /** action='goto' 时必填,必须存在一条 kind='on-error' 的出边指向该节点. */
  target?: string;
  retry?: {
    max: number;
    backoffMs: number;
    jitter?: boolean;
    /** 命中这些 code 才重试; 不填 = 所有错误. */
    retryOn?: string[];
  };
}

// ── Node types (10 种) ──────────────────────────────────────────────────────

interface NodeBase {
  id: string;
  metadata?: WorkflowStepMetadata;
  policy?: WorkflowStepPolicy;
  onError?: NodeOnError;
}

/** Agent 节点. out-degree: 1× next (+ 可选 on-error). */
export interface AgentNode extends NodeBase {
  type: 'agent';
  input: Record<string, unknown>;
  /** Agent 输出 JSON Schema. 未声明 = unknown (warning). */
  outputContract?: Record<string, unknown>;
}

export interface NotificationNode extends NodeBase {
  type: 'notification';
  input: Record<string, unknown>;
}

export interface CapabilityNode extends NodeBase {
  type: 'capability';
  input: Record<string, unknown>;
}

export interface WaitNode extends NodeBase {
  type: 'wait';
  input: { durationMs: number };
}

/** if-else 节点. out-degree: 1× then + 1× else (+ 可选 on-error). */
export interface IfElseNode extends NodeBase {
  type: 'if-else';
  input: { condition: ConditionExpr };
}

/** for-each 节点. out-degree: 1× body + 1× next (+ 可选 on-error). */
export interface ForEachNode extends NodeBase {
  type: 'for-each';
  input: {
    collection: string;
    itemVar: string;
    maxIterations?: number;
  };
}

/** 循环跨迭代状态。while 节点使用. */
export interface LoopState {
  initial: Record<string, unknown>;
  update?: Record<string, unknown>;
}

/** while / do-while 节点. out-degree: 1× body + 1× next (+ 可选 on-error). */
export interface WhileNode extends NodeBase {
  type: 'while';
  input: {
    condition: ConditionExpr;
    maxIterations?: number;
    mode?: 'while' | 'do-while';
    state?: LoopState;
  };
}

/**
 * parallel 节点. out-degree: N× next (N ≥ 2) (+ 可选 on-error).
 * 必须配对一个 join 节点汇合所有分支。
 * 默认 onBranchFail='wait-all' (安全,不越权)。
 */
export interface ParallelNode extends NodeBase {
  type: 'parallel';
  input: {
    onBranchFail?: 'fail-fast' | 'wait-all' | 'best-effort';
  };
}

/** join 节点. out-degree: 1× next (+ 可选 on-error). 入边 = 对应 parallel 的分支数. */
export interface JoinNode extends NodeBase {
  type: 'join';
  input?: Record<string, never>;
}

/**
 * approval 节点. out-degree: 1× next (+ 可选 on-error).
 * 运行时挂起工作流, 状态持久化到 approval_requests 表。
 */
export interface ApprovalNode extends NodeBase {
  type: 'approval';
  input: {
    prompt: string;
    approvers: {
      mode: 'any' | 'all' | 'quorum';
      users: string[];
      quorum?: number;
    };
    timeout?: {
      /** ISO 8601 duration, e.g. "PT1H" / "P1D". */
      duration: string;
      onTimeout: 'approve' | 'reject' | 'goto';
      /** onTimeout='goto' 时必填,配合一条 on-error 边. */
      target?: string;
    };
    /** 审批人可回填的结构化数据 JSON Schema. */
    formSchema?: Record<string, unknown>;
  };
}

export type WorkflowNode =
  | AgentNode
  | NotificationNode
  | CapabilityNode
  | WaitNode
  | IfElseNode
  | ForEachNode
  | WhileNode
  | ParallelNode
  | JoinNode
  | ApprovalNode;

export type WorkflowNodeType = WorkflowNode['type'];

// ── DSL v3 root ─────────────────────────────────────────────────────────────

export interface WorkflowDSLV3 {
  version: 'v3';
  name: string;
  description?: string;
  params?: WorkflowParamDef[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** 工作流执行总时长限制 (ms). */
  maxDurationMs?: number;
}

// ── Out-degree spec (结构校验器用) ──────────────────────────────────────────
//
// on-error 出边统一 0 或 1 条,不在此表,校验器单独处理。

type OutDegreeRule = { mode: 'exact'; count: number } | { mode: 'at-least'; count: number };

export interface NodeOutDegreeSpec {
  next?: OutDegreeRule;
  then?: OutDegreeRule;
  else?: OutDegreeRule;
  body?: OutDegreeRule;
}

export const NODE_OUT_DEGREE: Record<WorkflowNodeType, NodeOutDegreeSpec> = {
  agent:        { next: { mode: 'exact', count: 1 } },
  notification: { next: { mode: 'exact', count: 1 } },
  capability:   { next: { mode: 'exact', count: 1 } },
  wait:         { next: { mode: 'exact', count: 1 } },
  'if-else':    { then: { mode: 'exact', count: 1 }, else: { mode: 'exact', count: 1 } },
  'for-each':   { body: { mode: 'exact', count: 1 }, next: { mode: 'exact', count: 1 } },
  while:        { body: { mode: 'exact', count: 1 }, next: { mode: 'exact', count: 1 } },
  parallel:     { next: { mode: 'at-least', count: 2 } },
  join:         { next: { mode: 'exact', count: 1 } },
  approval:     { next: { mode: 'exact', count: 1 } },
};

// ── Limits ──────────────────────────────────────────────────────────────────

export const WORKFLOW_MAX_NODES = 100;
export const PARALLEL_MAX_BRANCHES = 10;
export const FOR_EACH_MAX_ITERATIONS_DEFAULT = 50;
export const WHILE_MAX_ITERATIONS_DEFAULT = 20;
export const FOR_EACH_MAX_ITERATIONS_HARD = 200;
export const WHILE_MAX_ITERATIONS_HARD = 100;
