import { z } from 'zod';
import type {
  ConditionExpr,
  GenerateWorkflowValidation,
} from './types';
import type { WorkflowDSLV3 } from './types-v3';
import { WORKFLOW_MAX_NODES } from './types-v3';

// ── Shared primitives ──────────────────────────────────────────────────────

const SAFE_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

const safeId = z.string().min(1).max(100).regex(
  SAFE_IDENTIFIER_RE,
  'must be a safe identifier (letters, digits, hyphens, underscores; start with letter)',
);

const jsIdentifier = z.string().min(1).max(50).regex(
  SAFE_IDENTIFIER_RE,
  'must be a safe JS identifier',
);

const conditionExprSchema: z.ZodType<ConditionExpr> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal('exists'), ref: z.string().min(1) }).strict(),
    z.object({ op: z.literal('eq'), left: z.string().min(1), right: z.unknown() }).strict(),
    z.object({ op: z.literal('neq'), left: z.string().min(1), right: z.unknown() }).strict(),
    z.object({ op: z.literal('gt'), left: z.string().min(1), right: z.unknown() }).strict(),
    z.object({ op: z.literal('lt'), left: z.string().min(1), right: z.unknown() }).strict(),
    z.object({ op: z.literal('and'), conditions: z.array(conditionExprSchema).min(1) }).strict(),
    z.object({ op: z.literal('or'), conditions: z.array(conditionExprSchema).min(1) }).strict(),
    z.object({ op: z.literal('not'), condition: conditionExprSchema }).strict(),
  ]),
);

const stepPolicySchema = z
  .object({
    timeoutMs: z.number().int().positive().optional(),
    retry: z.object({ maximumAttempts: z.number().int().positive().optional() }).strict().optional(),
    continueOnFailure: z.boolean().optional(),
  })
  .strict()
  .optional();

const stepMetadataSchema = z
  .object({
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    label: z.string().optional(),
  })
  .strict()
  .optional();

const paramDefSchema = z
  .object({
    name: jsIdentifier,
    type: z.enum(['string', 'number', 'boolean']),
    description: z.string().max(200).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    required: z.boolean().optional(),
  })
  .strict();

const loopStateSchema = z
  .object({
    initial: z.record(z.string(), z.unknown()),
    update: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ── Error handling ─────────────────────────────────────────────────────────

const onErrorSchema = z
  .object({
    action: z.enum(['fail', 'continue', 'goto']),
    target: safeId.optional(),
    retry: z
      .object({
        max: z.number().int().min(0).max(10),
        backoffMs: z.number().int().min(0).max(60_000),
        jitter: z.boolean().optional(),
        retryOn: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => (v.action === 'goto' ? !!v.target : true), {
    message: "onError.target is required when action='goto'",
    path: ['target'],
  });

// ── Per-node input schemas ─────────────────────────────────────────────────

const waitInputSchema = z.object({ durationMs: z.number().int().positive() }).strict();

const ifElseInputSchema = z.object({ condition: conditionExprSchema }).strict();

const forEachInputSchema = z
  .object({
    collection: z.string().min(1),
    itemVar: jsIdentifier,
    maxIterations: z.number().int().positive().max(200).optional(),
  })
  .strict();

const whileInputSchema = z
  .object({
    condition: conditionExprSchema,
    maxIterations: z.number().int().positive().max(100).optional(),
    mode: z.enum(['while', 'do-while']).optional(),
    state: loopStateSchema.optional(),
  })
  .strict();

const parallelInputSchema = z
  .object({ onBranchFail: z.enum(['fail-fast', 'wait-all', 'best-effort']).optional() })
  .strict();

const joinInputSchema = z.object({}).strict().optional();

const approvalInputSchema = z
  .object({
    prompt: z.string().min(1).max(2000),
    approvers: z
      .object({
        mode: z.enum(['any', 'all', 'quorum']),
        users: z.array(z.string().min(1)).min(1).max(50),
        quorum: z.number().int().positive().optional(),
      })
      .strict()
      .refine((v) => (v.mode === 'quorum' ? typeof v.quorum === 'number' && v.quorum <= v.users.length : true), {
        message: "approvers.quorum required when mode='quorum' and must be ≤ users.length",
        path: ['quorum'],
      }),
    timeout: z
      .object({
        duration: z.string().regex(/^P(T.+)?.*$/, 'must be ISO 8601 duration, e.g. PT1H or P1D'),
        onTimeout: z.enum(['approve', 'reject', 'goto']),
        target: safeId.optional(),
      })
      .strict()
      .refine((v) => (v.onTimeout === 'goto' ? !!v.target : true), {
        message: "timeout.target required when onTimeout='goto'",
        path: ['target'],
      })
      .optional(),
    formSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ── Node union ─────────────────────────────────────────────────────────────

function nodeBase<T extends z.ZodTypeAny>(typeLit: string, inputSchema: T) {
  return z.object({
    id: safeId,
    type: z.literal(typeLit),
    input: inputSchema,
    metadata: stepMetadataSchema,
    policy: stepPolicySchema,
    onError: onErrorSchema.optional(),
  });
}

const nodeSchema = z.discriminatedUnion('type', [
  nodeBase('agent', z.record(z.string(), z.unknown())).extend({
    outputContract: z.record(z.string(), z.unknown()).optional(),
  }),
  nodeBase('team', z.object({ teamId: z.string().min(1), task: z.string().min(1) }).strict()),
  nodeBase('notification', z.record(z.string(), z.unknown())),
  nodeBase('capability', z.record(z.string(), z.unknown())),
  nodeBase('wait', waitInputSchema),
  nodeBase('if-else', ifElseInputSchema),
  nodeBase('for-each', forEachInputSchema),
  nodeBase('while', whileInputSchema),
  nodeBase('parallel', parallelInputSchema),
  z.object({
    id: safeId,
    type: z.literal('join'),
    input: joinInputSchema,
    metadata: stepMetadataSchema,
    policy: stepPolicySchema,
    onError: onErrorSchema.optional(),
  }),
  nodeBase('approval', approvalInputSchema),
]);

// ── Edge ───────────────────────────────────────────────────────────────────

const edgeSchema = z
  .object({
    from: safeId,
    to: safeId,
    kind: z.enum(['next', 'then', 'else', 'body', 'on-error']),
    branchIndex: z.number().int().min(0).max(50).optional(),
  })
  .strict()
  .refine((e) => e.from !== e.to, { message: 'edge cannot self-loop (from === to)', path: ['to'] });

// ── DSL v3 root ────────────────────────────────────────────────────────────

export const workflowDslV3Schema: z.ZodType<WorkflowDSLV3> = z
  .object({
    version: z.literal('v3'),
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    params: z.array(paramDefSchema).max(20).optional(),
    nodes: z.array(nodeSchema).min(1).max(WORKFLOW_MAX_NODES),
    edges: z.array(edgeSchema).max(WORKFLOW_MAX_NODES * 3),
    maxDurationMs: z.number().int().positive().optional(),
  })
  .strict() as unknown as z.ZodType<WorkflowDSLV3>;

// ── Field-level validator (schema 级, 结构规则在 dsl-validator.ts) ─────────

export function validateWorkflowDslV3(spec: unknown): GenerateWorkflowValidation {
  const parsed = workflowDslV3Schema.safeParse(spec);
  if (parsed.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: parsed.error.issues.map((issue) => {
      const path = issue.path.map((s) => (typeof s === 'symbol' ? s.toString() : String(s))).join('.');
      return `${path || 'spec'}: ${issue.message}`;
    }),
  };
}

export function assertValidWorkflowDslV3(spec: unknown): asserts spec is WorkflowDSLV3 {
  const r = validateWorkflowDslV3(spec);
  if (!r.valid) throw new Error(r.errors.join('\n'));
}
