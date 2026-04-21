import os from 'os';
import path from 'path';
import {
  getRunHistory,
  getScheduledWorkflow,
  getWorkflowExecutionId,
  type ScheduleRunRecord,
} from '@/lib/db/scheduled-workflows';
import { listRunSteps, type ScheduleRunStep } from '@/lib/db/schedule-run-steps';
import { listAgentPresets } from '@/lib/db/agent-presets';
import { getMessages, getSession } from '@/lib/db/sessions';
import { parseStepHeader } from '@/lib/workflow/step-output-formatter';
import { listRunAttempts } from '@/lib/workflow/step-attempts';
import { collectStepInputSnapshots, type StepInputSnapshotFile } from '@/lib/workflow/step-input-snapshot';
import { collectRunOutputFiles, type RunOutputFile } from '@/lib/workflow/run-output-collector';
import { collectRunLiveTraces, type StepTraceEvent } from '@/lib/workflow/step-trace-stream';
import type { WorkflowDSLV3 } from '@/lib/workflow/types';

export interface ScheduleRunDetailMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export type ScheduleRunOutputFile = RunOutputFile;

export interface ScheduleStepOverlay {
  status: ScheduleRunStep['status'];
  durationMs: number | null;
  outputFileCount: number;
  outputSummary: string;
  error: string;
  attempt?: number;
  maxAttempts?: number;
}

export interface ScheduleRunDetailPayload {
  run: ScheduleRunRecord;
  steps: ScheduleRunStep[];
  messages: ScheduleRunDetailMessage[];
  outputFiles: ScheduleRunOutputFile[];
  workflowDsl: WorkflowDSLV3 | null;
  workflowDslSource: 'snapshot' | 'live' | 'none';
  stepOverlays: Record<string, ScheduleStepOverlay>;
  presetNames: Record<string, string>;
  /** Per-step snapshot of everything the engine handed to the agent (resolved input / runtime / agent / payload). */
  stepInputSnapshots: Record<string, StepInputSnapshotFile>;
  /** Per-step live trace events (assistant text / tool_use / tool_result), streamed to disk as they arrive. */
  stepLiveTraces: Record<string, StepTraceEvent[]>;
}

function getWorkflowAgentRootDir(): string {
  const baseDir = process.env.LUMOS_DATA_DIR
    || process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.lumos');
  return path.join(baseDir, 'workflow-agent-runs');
}

function buildStepAgentNameMap(messages: Array<{ role: string; content: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    let markdown = msg.content;
    try {
      const blocks = JSON.parse(markdown) as Array<{ type: string; text?: string }>;
      if (Array.isArray(blocks)) {
        markdown = blocks
          .filter((block) => block.type === 'text' && block.text)
          .map((block) => block.text as string)
          .join('\n');
      }
    } catch {
      // Use raw markdown when the message content is not structured JSON.
    }
    const parsed = parseStepHeader(markdown);
    if (parsed?.roleName && parsed?.stepId) {
      map.set(parsed.stepId, parsed.roleName);
    }
  }
  return map;
}

function resolveWorkflowDsl(
  run: ScheduleRunRecord,
): { dsl: WorkflowDSLV3 | null; source: 'snapshot' | 'live' | 'none' } {
  if (run.workflowDslSnapshot) {
    return { dsl: run.workflowDslSnapshot, source: 'snapshot' };
  }
  const schedule = getScheduledWorkflow(run.scheduleId);
  if (schedule?.workflowDsl) {
    return { dsl: schedule.workflowDsl, source: 'live' };
  }
  return { dsl: null, source: 'none' };
}

function buildStepOverlays(
  steps: ScheduleRunStep[],
  outputFiles: ScheduleRunOutputFile[],
  workflowRunId: string | null,
): Record<string, ScheduleStepOverlay> {
  const fileCounts = new Map<string, number>();
  for (const f of outputFiles) {
    fileCounts.set(f.stepId, (fileCounts.get(f.stepId) ?? 0) + 1);
  }
  const attemptsByStep = new Map<string, { attempt: number; maxAttempts: number }>();
  if (workflowRunId) {
    for (const a of listRunAttempts(workflowRunId)) {
      attemptsByStep.set(a.stepId, { attempt: a.attempt, maxAttempts: a.maxAttempts });
    }
  }
  const overlays: Record<string, ScheduleStepOverlay> = {};
  for (const s of steps) {
    const retry = attemptsByStep.get(s.stepId);
    overlays[s.stepId] = {
      status: s.status,
      durationMs: s.durationMs,
      outputFileCount: fileCounts.get(s.stepId) ?? 0,
      outputSummary: s.outputSummary,
      error: s.error,
      ...(retry ? { attempt: retry.attempt, maxAttempts: retry.maxAttempts } : {}),
    };
  }
  // Steps with files but no run-step row (e.g. legacy runs) still get a minimal overlay.
  for (const [stepId, count] of fileCounts) {
    if (!overlays[stepId]) {
      overlays[stepId] = {
        status: 'success',
        durationMs: null,
        outputFileCount: count,
        outputSummary: '',
        error: '',
      };
    }
  }
  // Retry-only overlays (step never landed in run_steps yet but is mid-retry).
  for (const [stepId, retry] of attemptsByStep) {
    if (!overlays[stepId]) {
      overlays[stepId] = {
        status: 'running',
        durationMs: null,
        outputFileCount: 0,
        outputSummary: '',
        error: '',
        attempt: retry.attempt,
        maxAttempts: retry.maxAttempts,
      };
    }
  }
  return overlays;
}

function buildPresetNameMap(dsl: WorkflowDSLV3 | null): Record<string, string> {
  if (!dsl) return {};
  const presetIds = new Set<string>();
  for (const node of dsl.nodes) {
    if (node.type === 'agent') {
      const preset = (node.input as Record<string, unknown> | undefined)?.preset;
      if (typeof preset === 'string' && preset) presetIds.add(preset);
    }
  }
  if (presetIds.size === 0) return {};
  const map: Record<string, string> = {};
  for (const p of listAgentPresets()) {
    if (presetIds.has(p.id)) map[p.id] = p.name;
  }
  return map;
}

export async function getScheduleRunDetail(
  runId: string,
  scheduleId?: string,
): Promise<ScheduleRunDetailPayload | null> {
  const run = getRunHistory(runId);
  if (!run) return null;
  if (scheduleId && run.scheduleId !== scheduleId) return null;

  let messages: ScheduleRunDetailMessage[] = [];
  if (run.sessionId) {
    const session = getSession(run.sessionId);
    if (session) {
      const result = getMessages(run.sessionId, { limit: 200 });
      messages = result.messages as ScheduleRunDetailMessage[];
    }
  }

  const agentNameMap = buildStepAgentNameMap(messages);

  let outputFiles: ScheduleRunOutputFile[] = [];
  let stepInputSnapshots: Record<string, StepInputSnapshotFile> = {};
  let stepLiveTraces: Record<string, StepTraceEvent[]> = {};
  if (run.sessionId) {
    const executionId = getWorkflowExecutionId(run.sessionId);
    if (executionId) {
      const runWorkspaceRoot = path.join(getWorkflowAgentRootDir(), executionId);
      outputFiles = await collectRunOutputFiles(runWorkspaceRoot, agentNameMap);
      stepInputSnapshots = await collectStepInputSnapshots(runWorkspaceRoot);
      stepLiveTraces = await collectRunLiveTraces(runWorkspaceRoot);
    }
  }

  const steps = listRunSteps(runId);
  const { dsl, source } = resolveWorkflowDsl(run);
  const workflowRunId = run.sessionId ? getWorkflowExecutionId(run.sessionId) : null;
  const stepOverlays = buildStepOverlays(steps, outputFiles, workflowRunId);
  const presetNames = buildPresetNameMap(dsl);

  return {
    run,
    steps,
    messages,
    outputFiles,
    workflowDsl: dsl,
    workflowDslSource: source,
    stepOverlays,
    presetNames,
    stepInputSnapshots,
    stepLiveTraces,
  };
}
