import { validateWorkflowDslV3 } from './dsl-v3-schema';
import { validateDslStructure, type ValidationIssue, type ValidationReport } from './dsl-validator';
import type { AgentNode, WorkflowDSLV3 } from './types-v3';

// ── Unified write-time validator ───────────────────────────────────────────
//
// 编辑器 / LLM 写入 DSL 后,都走这个入口:
// 1. zod 字段层 (类型、必填、正则...)  — 任何一条失败就短路,避免结构检查拿到畸形 DSL
// 2. 结构层 (边、出度、拓扑前驱、loop 作用域...)
// 3. outputContract 字段声明一致性 (warning): `{{ steps.X.output.foo }}` 中 foo
//    应在 X 的 outputContract.properties 中声明。未声明不阻断,仅警告
//    (因为 contract 自身是可选的 schema)。

export interface UnifiedValidationReport extends ValidationReport {
  /** 仅字段层错误;如果有,结构层和 contract 层都被跳过。 */
  schemaErrors: string[];
}

export function validateDsl(spec: unknown): UnifiedValidationReport {
  const schema = validateWorkflowDslV3(spec);
  if (!schema.valid) {
    return {
      valid: false,
      issues: schema.errors.map((msg) => ({
        severity: 'error' as const,
        code: 'E_SCHEMA',
        jsonPath: extractPath(msg),
        message: msg,
      })),
      schemaErrors: schema.errors,
    };
  }
  const dsl = spec as WorkflowDSLV3;
  const structural = validateDslStructure(dsl);
  const contractIssues = checkOutputContractReferences(dsl);
  const issues: ValidationIssue[] = [...structural.issues, ...contractIssues];
  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
    schemaErrors: [],
  };
}

function extractPath(message: string): string {
  const idx = message.indexOf(':');
  return idx === -1 ? '' : message.slice(0, idx);
}

// ── outputContract 顶层字段声明一致性 (warning) ────────────────────────────

// Capture the first path segment after `output` or `output?.`.
// Tolerates optional-chain + ?? default, e.g. {{ steps.x.output?.foo ?? 'def' }}.
const REF_WITH_PATH = /\{\{\s*steps\.([A-Za-z][A-Za-z0-9_-]*)\.output\??\.([A-Za-z_][A-Za-z0-9_]*)/g;
const DIRECT_REF_WITH_PATH = /^steps\.([A-Za-z][A-Za-z0-9_-]*)\.output\??\.([A-Za-z_][A-Za-z0-9_]*)/;

function collectRefPaths(value: unknown, acc: Array<{ nodeId: string; field: string }>): void {
  if (typeof value === 'string') {
    for (const m of value.matchAll(REF_WITH_PATH)) acc.push({ nodeId: m[1], field: m[2] });
    const direct = DIRECT_REF_WITH_PATH.exec(value);
    if (direct) acc.push({ nodeId: direct[1], field: direct[2] });
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefPaths(v, acc);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectRefPaths(v, acc);
  }
}

function getContractProps(node: AgentNode): Set<string> | undefined {
  const c = node.outputContract;
  if (!c || typeof c !== 'object') return undefined;
  const props = (c as { properties?: unknown }).properties;
  if (!props || typeof props !== 'object') return undefined;
  return new Set(Object.keys(props as Record<string, unknown>));
}

function checkOutputContractReferences(dsl: WorkflowDSLV3): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const agents = new Map<string, AgentNode>();
  for (const n of dsl.nodes) {
    if (n.type === 'agent') agents.set(n.id, n);
  }
  for (const node of dsl.nodes) {
    const refs: Array<{ nodeId: string; field: string }> = [];
    collectRefPaths((node as { input?: unknown }).input, refs);
    for (const ref of refs) {
      const target = agents.get(ref.nodeId);
      if (!target) continue; // 非 agent 节点不走 contract 校验
      const declared = getContractProps(target);
      if (!declared) continue; // 未声明 contract = 允许所有字段
      if (!declared.has(ref.field)) {
        issues.push({
          severity: 'error',
          code: 'E_CONTRACT_FIELD_UNDECLARED',
          nodeId: node.id,
          jsonPath: `nodes[${node.id}].input`,
          message: `reference "steps.${ref.nodeId}.output.${ref.field}" is not declared in "${ref.nodeId}".outputContract`,
          expected: [...declared],
          actual: ref.field,
          hint: 'Add the field to outputContract.properties or rename the reference.',
        });
      }
    }
  }
  return issues;
}
