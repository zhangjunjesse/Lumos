import { readdir, readFile, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  getRunHistory,
  getWorkflowExecutionId,
  type ScheduleRunRecord,
} from '@/lib/db/scheduled-workflows';
import { listRunSteps, type ScheduleRunStep } from '@/lib/db/schedule-run-steps';
import { getMessages, getSession } from '@/lib/db/sessions';
import { parseStepHeader } from '@/lib/workflow/step-output-formatter';

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

export interface ScheduleRunDetailPayload {
  run: ScheduleRunRecord;
  steps: ScheduleRunStep[];
  messages: ScheduleRunDetailMessage[];
  outputFiles: ScheduleRunOutputFile[];
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

    const files = await readdir(outputDir).catch(() => [] as string[]);
    for (const fileName of files) {
      if (fileName.startsWith('.')) continue;
      const filePath = path.join(outputDir, fileName);
      try {
        const mimeType = getFileMimeType(fileName);
        const fileStat = await stat(filePath);
        let content = '';

        if (mimeType?.startsWith('image/')) {
          const buffer = await readFile(filePath);
          content = buffer.toString('base64');
        } else if (isTextLikeMimeType(mimeType)) {
          content = await readFile(filePath, 'utf-8');
        }

        results.push({
          name: fileName,
          stepId: stageId,
          agentName: agentNameMap.get(stageId) || stageId,
          filePath,
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

  results.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
  return results;
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
  return { run, steps, messages, outputFiles };
}
