import { readdir, readFile, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getRunHistory, getWorkflowExecutionId } from '@/lib/db/scheduled-workflows';
import { getMessages, getSession } from '@/lib/db';
import { parseStepHeader } from '@/lib/workflow/step-output-formatter';

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

interface OutputFile {
  name: string;
  stepId: string;
  agentName: string;
  content: string;
  sizeBytes: number;
  mimeType?: string;
}

const BINARY_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  pdf: 'application/pdf',
};

function getFileMimeType(fileName: string): string | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_MIME[ext];
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
    let md = msg.content;
    try {
      const blocks = JSON.parse(md) as Array<{ type: string; text?: string }>;
      if (Array.isArray(blocks)) {
        md = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text as string).join('\n');
      }
    } catch { /* not JSON, use as-is */ }
    const parsed = parseStepHeader(md);
    if (parsed?.roleName && parsed?.stepId) {
      map.set(parsed.stepId, parsed.roleName);
    }
  }
  return map;
}

async function dirExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function collectRunOutputFiles(
  executionId: string,
  agentNameMap: Map<string, string>,
): Promise<OutputFile[]> {
  const runDir = path.join(getWorkflowAgentRootDir(), executionId);
  const stagesDir = path.join(runDir, 'stages');
  if (!await dirExists(stagesDir)) return [];

  const results: OutputFile[] = [];
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
        const isBinary = Boolean(mimeType);
        const buf = await readFile(filePath);
        const content = isBinary ? buf.toString('base64') : buf.toString('utf-8');
        results.push({
          name: fileName,
          stepId: stageId,
          agentName: agentNameMap.get(stageId) || stageId,
          content,
          sizeBytes: buf.byteLength,
          ...(mimeType ? { mimeType } : {}),
        });
      } catch { /* skip unreadable */ }
    }
  }

  return results;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id: scheduleId, runId } = await context.params;
    const run = getRunHistory(runId);
    if (!run || run.scheduleId !== scheduleId) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    let messages: Array<{ id: string; role: string; content: string; created_at: string }> = [];
    if (run.sessionId) {
      const session = getSession(run.sessionId);
      if (session) {
        const result = getMessages(run.sessionId, { limit: 200 });
        messages = result.messages as typeof messages;
      }
    }

    const agentNameMap = buildStepAgentNameMap(messages);

    let outputFiles: OutputFile[] = [];
    if (run.sessionId) {
      const executionId = getWorkflowExecutionId(run.sessionId);
      if (executionId) {
        outputFiles = await collectRunOutputFiles(executionId, agentNameMap);
      }
    }

    return NextResponse.json({ run, messages, outputFiles });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch run';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
