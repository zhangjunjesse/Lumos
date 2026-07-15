import { createHash } from 'node:crypto';
import { extractBlocks } from './compiler-v3-blocks';
import { emitBlock } from './compiler-v3-emitters';
import { emitLiteral, emitRuntimeHelpers, resolveCompiledStepTimeoutMs } from './compiler-helpers';
import type { WorkflowStep } from './types';
import type { CompiledWorkflowManifest, GenerateWorkflowResult } from './types';
import { validateDsl } from './validate-dsl-v3';
import type { WorkflowDSLV3, WorkflowNode } from './types-v3';

// ── v3 编译器入口 ──────────────────────────────────────────────────────────
//
// 流程: validateDsl (schema + structural) → extractBlocks (块树) → emitBlock
// (块 → JS 源码) → wrapModuleV3 (工厂模块外壳) → buildManifestV3。
// 任何一步失败都以 GenerateWorkflowResult 形式返回,不抛异常。

export function compileWorkflowDslV3(spec: unknown): GenerateWorkflowResult {
  const validation = validateDsl(spec);
  if (!validation.valid) {
    const errors = validation.issues
      .filter((i) => i.severity === 'error')
      .map((i) => `${i.code} ${i.jsonPath}: ${i.message}`);
    return { code: '', manifest: emptyManifest(), validation: { valid: false, errors } };
  }
  const dsl = spec as WorkflowDSLV3;
  const block = extractBlocks(dsl);
  const nodeById = new Map(dsl.nodes.map((n) => [n.id, n]));
  const body = emitBlock(block, { nodeById, outerStateExpr: 'undefined' }, 6);
  const version = createWorkflowVersionV3(dsl);
  const code = wrapModuleV3(dsl.name, version, body, dsl.nodes.length);
  const manifest = buildManifestV3(dsl, version);
  const warnings = validation.issues.filter((i) => i.severity === 'warning').map((i) => `${i.code}: ${i.message}`);
  manifest.warnings = warnings;
  return { code, manifest, validation: { valid: true, errors: [] } };
}

// ── Version hash ───────────────────────────────────────────────────────────

export function createWorkflowVersionV3(dsl: WorkflowDSLV3): string {
  const normalized = JSON.stringify(dsl, Object.keys(dsl).sort());
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `dsl-v3-${hash}`;
}

// ── Manifest ───────────────────────────────────────────────────────────────

function buildManifestV3(dsl: WorkflowDSLV3, workflowVersion: string): CompiledWorkflowManifest {
  const stepTimeouts = dsl.nodes.map((n) => resolveTimeoutForNode(n) ?? 0);
  return {
    dslVersion: 'v3',
    artifactKind: 'workflow-factory-module',
    exportedSymbol: 'buildWorkflow',
    workflowName: dsl.name,
    workflowVersion,
    stepIds: dsl.nodes.map((n) => n.id),
    stepTypes: dsl.nodes.map((n) => n.type),
    stepTimeoutsMs: stepTimeouts,
    ...(dsl.maxDurationMs ? { maxDurationMs: dsl.maxDurationMs } : {}),
    warnings: [],
  };
}

function resolveTimeoutForNode(node: WorkflowNode): number | undefined {
  // 对 v1/v2 支持的 type 复用 resolveCompiledStepTimeoutMs;approval/parallel/join 不设 timeout。
  const step: WorkflowStep = {
    id: node.id,
    type: node.type as WorkflowStep['type'],
    input: (node as { input?: Record<string, unknown> }).input,
    policy: node.policy,
  };
  return resolveCompiledStepTimeoutMs(step);
}

function emptyManifest(): CompiledWorkflowManifest {
  return {
    dslVersion: 'v3',
    artifactKind: 'workflow-factory-module',
    exportedSymbol: 'buildWorkflow',
    workflowName: '',
    workflowVersion: '',
    stepIds: [],
    stepTypes: [],
    warnings: [],
  };
}

// ── Module wrapper ────────────────────────────────────────────────────────

function wrapModuleV3(name: string, version: string, body: string, nodeCount: number): string {
  const helpers = emitRuntimeHelpers();
  const maxGotoPasses = Math.max(1, nodeCount + 1);
  return [
    "import { defineWorkflow } from 'openworkflow';",
    '',
    ...helpers,
    '',
    'export function buildWorkflow(runtime) {',
    '  const {',
    '    agentStep, teamStep, notificationStep, capabilityStep, waitStep,',
    '    approvalStep = async () => ({ success: true, output: { status: "auto-approved" } }),',
    '    onStepStarted, onStepCompleted, onStepSkipped, onStepOutput',
    '  } = runtime;',
    '',
    '  return defineWorkflow(',
    `    { name: ${emitLiteral(name)}, version: ${emitLiteral(version)} },`,
    '    async ({ input, step, run }) => {',
    '      const stepOutputs = {};',
    '      let __goto = null;',
    "      class __GotoSignal extends Error { constructor(target) { super(`Workflow goto: ${String(target)}`); this.name = 'GotoSignal'; this.target = target; } }",
    '      function __shouldSkipBlock(nodeIds) {',
    '        return Boolean(__goto) && Array.isArray(nodeIds) && !nodeIds.includes(__goto);',
    '      }',
    '      function __shouldSkipStep(stepId) {',
    '        if (!__goto) return false;',
    '        if (__goto === stepId) {',
    '          __goto = null;',
    '          return false;',
    '        }',
    '        return true;',
    '      }',
    `      const __maxGotoPasses = ${maxGotoPasses};`,
    '      let __gotoPasses = 0;',
    '      while (true) {',
    '        if (__gotoPasses++ > __maxGotoPasses) {',
    '          throw new Error(`Workflow goto exceeded replay limit while targeting "${String(__goto)}"`);',
    '        }',
    '        try {',
    body,
    '          break;',
    '        } catch (__err) {',
    '          if (__err instanceof __GotoSignal) continue;',
    '          throw __err;',
    '        }',
    '      }',
    '',
    '      return stepOutputs;',
    '    }',
    '  );',
    '}',
    '',
  ].join('\n');
}
