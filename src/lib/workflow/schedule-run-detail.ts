import { readdir, readFile, stat } from 'fs/promises';
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
import type { WorkflowDSL } from '@/lib/workflow/types';

export interface ScheduleRunDetailMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface ScheduleRunOutputFile {
  name: string;
  stepId: string;
  agentName: string;
  content: string;
  sizeBytes: number;
  filePath: string;
  mimeType?: string;
  createdAt?: string;
}

export interface ScheduleStepOverlay {
  status: ScheduleRunStep['status'];
  durationMs: number | null;
  outputFileCount: number;
  outputSummary: string;
  error: string;
}

export interface ScheduleRunDetailPayload {
  run: ScheduleRunRecord;
  steps: ScheduleRunStep[];
  messages: ScheduleRunDetailMessage[];
  outputFiles: ScheduleRunOutputFile[];
  workflowDsl: WorkflowDSL | null;
  workflowDslSource: 'snapshot' | 'live' | 'none';
  stepOverlays: Record<string, ScheduleStepOverlay>;
  presetNames: Record<string, string>;
}

const BINARY_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  mdx: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  xml: 'text/xml',
  html: 'text/html',
  htm: 'text/html',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

function getFileMimeType(fileName: string): string | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_MIME[ext];
}

function isTextLikeMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) {
    return true;
  }
  return mimeType.startsWith('text/')
    || mimeType === 'application/json';
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

async function dirExists(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function collectRunOutputFiles(
  executionId: string,
  agentNameMap: Map<string, string>,
): Promise<ScheduleRunOutputFile[]> {
  const runDir = path.join(getWorkflowAgentRootDir(), executionId);
  const stagesDir = path.join(runDir, 'stages');
  if (!await dirExists(stagesDir)) return [];

  const results: ScheduleRunOutputFile[] = [];
  const stageIds = await readdir(stagesDir).catch(() => [] as string[]);

  for (const stageId of stageIds) {
    const outputDir = path.join(stagesDir, stageId, 'output');
    if (!await dirExists(outputDir)) continue;
    await walkOutputDir(outputDir, '', stageId, agentNameMap, results);
  }

  results.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
  return results;
}

/**
 * Recursively walk the step's output dir and collect every file. Subdirectory
 * paths are preserved in `name` so `main/img_01.jpg` stays distinguishable
 * from `detail/img_01.jpg`.
 */
async function walkOutputDir(
  rootDir: string,
  relativePrefix: string,
  stageId: string,
  agentNameMap: Map<string, string>,
  results: ScheduleRunOutputFile[],
): Promise<void> {
  const currentDir = path.join(rootDir, relativePrefix);
  const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name;
    const abs = path.join(rootDir, rel);
    if (entry.isDirectory()) {
      await walkOutputDir(rootDir, rel, stageId, agentNameMap, results);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const mimeType = getFileMimeType(entry.name);
      const fileStat = await stat(abs);
      let content = '';
      if (mimeType?.startsWith('image/')) {
        content = (await readFile(abs)).toString('base64');
      } else if (isTextLikeMimeType(mimeType)) {
        content = await readFile(abs, 'utf-8');
      }
      results.push({
        name: rel.split(path.sep).join('/'),
        stepId: stageId,
        agentName: agentNameMap.get(stageId) || stageId,
        filePath: abs,
        content,
        sizeBytes: fileStat.size,
        createdAt: fileStat.mtime.toISOString(),
        ...(mimeType ? { mimeType } : {}),
      });
    } catch {
      // Ignore unreadable files and keep returning the rest of the report.
    }
  }
}

function resolveWorkflowDsl(
  run: ScheduleRunRecord,
): { dsl: WorkflowDSL | null; source: 'snapshot' | 'live' | 'none' } {
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
): Record<string, ScheduleStepOverlay> {
  const fileCounts = new Map<string, number>();
  for (const f of outputFiles) {
    fileCounts.set(f.stepId, (fileCounts.get(f.stepId) ?? 0) + 1);
  }
  const overlays: Record<string, ScheduleStepOverlay> = {};
  for (const s of steps) {
    overlays[s.stepId] = {
      status: s.status,
      durationMs: s.durationMs,
      outputFileCount: fileCounts.get(s.stepId) ?? 0,
      outputSummary: s.outputSummary,
      error: s.error,
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
  return overlays;
}

function buildPresetNameMap(dsl: WorkflowDSL | null): Record<string, string> {
  if (!dsl) return {};
  const presetIds = new Set<string>();
  for (const step of dsl.steps ?? []) {
    if (step.type === 'agent') {
      const preset = (step.input as Record<string, unknown> | undefined)?.preset;
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
  if (run.sessionId) {
    const executionId = getWorkflowExecutionId(run.sessionId);
    if (executionId) {
      outputFiles = await collectRunOutputFiles(executionId, agentNameMap);
    }
  }

  const steps = listRunSteps(runId);
  const { dsl, source } = resolveWorkflowDsl(run);
  const stepOverlays = buildStepOverlays(steps, outputFiles);
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
  };
}
