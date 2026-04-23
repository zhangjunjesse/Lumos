/**
 * A pre-execution snapshot of everything the workflow engine handed to an
 * agent step. Written to `{stageWorkspace}/_lumos_step_input.json` just before
 * `StageWorker.execute` fires, so the run detail UI can later show the user
 * exactly what context flowed into each node — resolved input, runtime, agent
 * binding, and the full `StageExecutionPayloadV1` — for debugging.
 *
 * The file is written at the stage workspace root (NOT under `input/`), so
 * the output-file walker (which recurses only under `output/`) will not pick
 * it up as a user-visible artifact.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import type { StageExecutionPayloadV1 } from '@/lib/team-run/runtime-contracts';
import type { AgentStepInput, WorkflowStepRuntimeContext } from './types';

export interface StepInputSnapshotFile {
  capturedAt: string;
  workflowRunId: string;
  stepId: string;
  timeoutMs: number | null;
  executionMode: string;
  requestedModel: string | null;
  /** `AgentStepInput` as it arrived — DSL references already resolved by the compiler. */
  resolvedInput: Record<string, unknown>;
  /** Runtime fields the compiler injected via `__runtime` (taskId, sessionId, workingDirectory, ...). */
  runtime: WorkflowStepRuntimeContext;
  /** Resolved agent role + binding (roleName / model / allowedTools / systemPrompt / ...). */
  agent?: {
    role: string;
    binding: Record<string, unknown>;
    ignoredToolRequests: string[];
  } | null;
  /** Code execution metadata for code-only / code-first steps. */
  code?: {
    strategy: string | null;
    handler: string | null;
    hasInlineScript: boolean;
    params: Record<string, unknown>;
  } | null;
  /** Workspace paths available to the step even when there is no StageWorker payload. */
  workspace?: StageExecutionPayloadV1['workspace'] | null;
  /** The exact payload object passed to `StageWorker.execute` when applicable. */
  payload?: StageExecutionPayloadV1 | null;
}

const SNAPSHOT_FILE_NAME = '_lumos_step_input.json';

export async function writeStepInputSnapshot(
  stageWorkspace: string,
  snapshot: StepInputSnapshotFile,
): Promise<void> {
  try {
    await mkdir(stageWorkspace, { recursive: true });
    await writeFile(
      path.join(stageWorkspace, SNAPSHOT_FILE_NAME),
      safeStringify(snapshot),
      'utf-8',
    );
  } catch (e) {
    // Snapshot failure must never break the step — this is debug-only metadata.
    console.warn('[step-input-snapshot] write failed:', e instanceof Error ? e.message : e);
  }
}

export async function readStepInputSnapshot(
  stageWorkspace: string,
): Promise<StepInputSnapshotFile | null> {
  try {
    const buf = await readFile(path.join(stageWorkspace, SNAPSHOT_FILE_NAME), 'utf-8');
    return JSON.parse(buf) as StepInputSnapshotFile;
  } catch {
    return null;
  }
}

/**
 * Walk the per-run stages directory and collect every snapshot file, keyed by
 * step id. Used by the run detail API to feed the UI.
 */
export async function collectStepInputSnapshots(
  runWorkspaceRoot: string,
): Promise<Record<string, StepInputSnapshotFile>> {
  const stagesDir = path.join(runWorkspaceRoot, 'stages');
  try {
    const info = await stat(stagesDir);
    if (!info.isDirectory()) return {};
  } catch { return {}; }
  const stageIds = await readdir(stagesDir).catch(() => [] as string[]);
  const out: Record<string, StepInputSnapshotFile> = {};
  for (const stageId of stageIds) {
    const snap = await readStepInputSnapshot(path.join(stagesDir, stageId));
    if (snap) out[stageId] = snap;
  }
  return out;
}

/** Strip runtime-carrier fields — they're persisted separately under `runtime`. */
export function sanitizeResolvedInput(input: AgentStepInput): Record<string, unknown> {
  const src = input as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === '__runtime' || k === '__lumosRuntime') continue;
    out[k] = v;
  }
  return out;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v as object)) return '[[circular]]';
      seen.add(v as object);
    }
    return v;
  }, 2);
}
