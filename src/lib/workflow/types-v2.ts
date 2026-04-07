import type { ConditionExpr, WorkflowStepPolicy, WorkflowStepMetadata } from './types';

// ── Control flow step input interfaces ──────────────────────────────────────

export interface IfElseStepInput {
  condition: ConditionExpr;
  then: string[];
  else?: string[];
}

export interface ForEachStepInput {
  collection: string;
  itemVar: string;
  body: string[];
  maxIterations?: number;
}

export interface WhileStepInput {
  condition: ConditionExpr;
  body: string[];
  maxIterations?: number;
  /** 'while' (default): evaluate condition before first iteration.
   *  'do-while': execute body once first, then evaluate condition. */
  mode?: 'while' | 'do-while';
}

// ── V2 step definition (union of all step types) ────────────────────────────

export interface AgentStepV2 {
  id: string;
  type: 'agent';
  dependsOn?: string[];
  when?: ConditionExpr;
  input: Record<string, unknown>;
  policy?: WorkflowStepPolicy;
  metadata?: WorkflowStepMetadata;
}

export interface IfElseStepV2 {
  id: string;
  type: 'if-else';
  dependsOn?: string[];
  input: IfElseStepInput;
  policy?: WorkflowStepPolicy;
  metadata?: WorkflowStepMetadata;
}

export interface ForEachStepV2 {
  id: string;
  type: 'for-each';
  dependsOn?: string[];
  input: ForEachStepInput;
  policy?: WorkflowStepPolicy;
  metadata?: WorkflowStepMetadata;
}

export interface WhileStepV2 {
  id: string;
  type: 'while';
  dependsOn?: string[];
  input: WhileStepInput;
  policy?: WorkflowStepPolicy;
  metadata?: WorkflowStepMetadata;
}

export type WorkflowStepV2 =
  | AgentStepV2
  | IfElseStepV2
  | ForEachStepV2
  | WhileStepV2;

// ── Default iteration limits ────────────────────────────────────────────────

export const FOR_EACH_MAX_ITERATIONS_DEFAULT = 50;
export const WHILE_MAX_ITERATIONS_DEFAULT = 20;
