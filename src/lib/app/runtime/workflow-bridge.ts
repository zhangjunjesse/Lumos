import type { AppRunContext } from './context';

/**
 * Workflow bridge — the contract for running an app-bundled workflow inside
 * a per-run AppRunContext.
 *
 * **Status**: M1 ships only the contract. The stub implementation
 * `createUnimplementedWorkflowBridge` throws on use so callers (page
 * renderer, app SDK) get a clean error during development. M3 replaces it
 * with a real adapter that:
 *
 *   1. Compiles the app's workflows/<id>.json (Workflow DSL V2) into
 *      executable code via lumos's existing compiler-v3-* pipeline.
 *   2. Invokes src/lib/workflow/engine.ts:submitWorkflow with the
 *      compiled artifacts plus a hook that consults
 *      AppRunContext.gate before any MCP / tool / fetch / fs operation.
 *   3. Returns a handle for cancel / status, and streams step outputs
 *      back through AppRunContext.recordStepOutput.
 *
 * Defining this surface up front lets the page renderer (M1 W4-5) wire
 * `button.run = "workflow:foo"` to a single call site without depending
 * on the engine's internal shape.
 */

export interface WorkflowRunHandle {
  workflowRunId: string;
  /** Cooperative cancellation. Resolves when the engine acknowledges. */
  cancel(): Promise<void>;
}

export interface WorkflowRunResult {
  /** Final output keyed by manifest's outputs[].name. */
  outputs: Record<string, unknown>;
  status: 'success' | 'failed' | 'cancelled';
  /** Engine's run id, joined with the per-app run history table. */
  workflowRunId: string;
  /** Time the engine reported the run as finished. */
  endedAt: number;
  /** Surfaced when status !== 'success'. */
  error?: { message: string; step?: string };
}

export interface WorkflowBridge {
  /**
   * Start a workflow by its id (must exist in the parsed app's workflows
   * map). Inputs are passed verbatim to the workflow's compiled body.
   *
   * The bridge is responsible for:
   *   - Resolving `{{ config.* }}` references in step prompts via
   *     ctx.vault.
   *   - Wrapping mcp / tool calls with ctx.gate.requireOrThrow checks.
   *   - Calling ctx.recordStepOutput(stepId, output) after each step.
   */
  runWorkflow(
    workflowId: string,
    inputs: Record<string, unknown>,
    ctx: AppRunContext,
  ): Promise<WorkflowRunResult>;

  /** Start without awaiting completion; for fire-and-forget flows. */
  startWorkflow?(
    workflowId: string,
    inputs: Record<string, unknown>,
    ctx: AppRunContext,
  ): Promise<WorkflowRunHandle>;
}

export class WorkflowBridgeNotReadyError extends Error {
  constructor() {
    super(
      'Workflow bridge is not implemented in M1. The contract is fixed; ' +
        'integration with src/lib/workflow/engine.ts is scheduled for M3. ' +
        'See src/lib/app/runtime/workflow-bridge.ts for the M3 plan.',
    );
    this.name = 'WorkflowBridgeNotReadyError';
  }
}

export function createUnimplementedWorkflowBridge(): WorkflowBridge {
  return {
    async runWorkflow() {
      throw new WorkflowBridgeNotReadyError();
    },
    async startWorkflow() {
      throw new WorkflowBridgeNotReadyError();
    },
  };
}
