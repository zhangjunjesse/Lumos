import { appendFile, copyFile, mkdir, readdir, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { AgentStepInput, StepResult, WorkflowStepRuntimeContext } from './types';
import type {
  AgentStepCodeConfig,
  CodeExecutionOutcome,
  CodeHandlerContext,
} from './code-handler-types';
import { getCodeHandler } from './code-handler-registry';
import { createBrowserBridgeApi, type BrowserBridgeDebugLogger } from './code-browser-bridge';

type DebugLogLevel = 'info' | 'warn' | 'error';
type DebugLogSource = 'code' | 'browser' | 'console';

interface DebugLogEntry {
  timestamp: string;
  level: DebugLogLevel;
  source: DebugLogSource;
  action: string;
  message: string;
  data?: Record<string, unknown>;
}

interface FileStateSnapshot {
  path: string;
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function getWorkflowAgentRootDir(): string {
  const baseDir = process.env.LUMOS_DATA_DIR
    || process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.lumos');
  return path.join(baseDir, 'workflow-agent-runs');
}

function resolveArtifactOutputDir(runtimeContext: WorkflowStepRuntimeContext): string {
  const safeRunId = sanitizePathSegment(runtimeContext.workflowRunId, 'workflow-run');
  const safeStepId = sanitizePathSegment(runtimeContext.stepId, 'agent-step');
  return path.join(getWorkflowAgentRootDir(), safeRunId, 'stages', safeStepId, 'output');
}

function resolveDebugLogPath(runtimeContext: WorkflowStepRuntimeContext): string {
  const safeRunId = sanitizePathSegment(runtimeContext.workflowRunId, 'workflow-run');
  const safeStepId = sanitizePathSegment(runtimeContext.stepId, 'agent-step');
  return path.join(resolveArtifactOutputDir(runtimeContext), `${safeRunId}_${safeStepId}_code-debug.log`);
}

function getBrowserDownloadsDir(): string {
  if (process.env.LUMOS_BROWSER_DOWNLOADS_DIR?.trim()) {
    return process.env.LUMOS_BROWSER_DOWNLOADS_DIR.trim();
  }
  return path.join(os.homedir(), 'Downloads', 'Lumos Browser');
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 15))}...(省略 ${value.length - maxLength} 字)`;
}

function serializeForLog(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatConsoleArgs(args: unknown[]): string {
  return args.map((arg) => truncateText(serializeForLog(arg), 500)).join(' ');
}

function normalizeLogData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value === 'string') {
      result[key] = truncateText(value, 1_500);
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function summarizeStepResult(result: StepResult): string | undefined {
  if (typeof result.output === 'string') {
    return truncateText(result.output, 300);
  }
  if (result.output && typeof result.output === 'object') {
    const summary = (result.output as Record<string, unknown>).summary;
    if (typeof summary === 'string' && summary.trim()) {
      return truncateText(summary.trim(), 300);
    }
  }
  if (result.error?.trim()) {
    return truncateText(result.error.trim(), 300);
  }
  return undefined;
}

function shouldCaptureBrowserDownloads(
  result: StepResult,
  debugLogger: CodeExecutionDebugLogger,
): boolean {
  if (debugLogger.hasBrowserActivity()) {
    return true;
  }

  const summary = summarizeStepResult(result) ?? '';
  return /下载|download/i.test(summary);
}

function ensureFailureError(result: StepResult): StepResult {
  if (result.success || result.error?.trim()) {
    return result;
  }

  return {
    ...result,
    error: summarizeStepResult(result) ?? 'Workflow code execution failed',
  };
}

function attachMetadata(
  result: StepResult,
  metadata: Record<string, string | undefined | null>,
): StepResult {
  const normalizedMetadata = Object.entries(metadata).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      acc[key] = value;
    }
    return acc;
  }, {});

  if (Object.keys(normalizedMetadata).length === 0) {
    return result;
  }

  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      ...normalizedMetadata,
    },
  };
}

function buildFailureSnapshotText(input: {
  page?: { id: string; title: string; url: string } | null;
  snapshot?: { title: string; content: string; url?: string } | null;
}): string {
  const title = input.snapshot?.title?.trim() || input.page?.title?.trim() || '';
  const url = input.snapshot?.url?.trim() || input.page?.url?.trim() || '';
  const pageId = input.page?.id?.trim() || '';

  return [
    title ? `Title: ${title}` : '',
    url ? `URL: ${url}` : '',
    pageId ? `Page ID: ${pageId}` : '',
    '',
    input.snapshot?.content ?? '',
  ].filter(Boolean).join('\n');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listBrowserDownloadFiles(): Promise<FileStateSnapshot[]> {
  const downloadsDir = getBrowserDownloadsDir();
  const fileNames = await readdir(downloadsDir).catch(() => [] as string[]);
  const results: FileStateSnapshot[] = [];

  for (const fileName of fileNames) {
    if (!fileName || fileName.startsWith('.')) {
      continue;
    }

    const filePath = path.join(downloadsDir, fileName);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        continue;
      }
      results.push({
        path: filePath,
        name: fileName,
        sizeBytes: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
      });
    } catch {
      // Ignore files that disappear while the directory is being scanned.
    }
  }

  return results;
}

function buildFileSnapshotMap(files: FileStateSnapshot[]): Map<string, FileStateSnapshot> {
  return new Map(files.map((file) => [file.path, file]));
}

async function ensureUniqueCopyTarget(targetDir: string, fileName: string): Promise<string> {
  let candidate = path.join(targetDir, fileName);
  const ext = path.extname(fileName);
  const baseName = ext ? fileName.slice(0, -ext.length) : fileName;
  let counter = 2;

  while (true) {
    try {
      await stat(candidate);
      candidate = path.join(targetDir, `${baseName} (${counter})${ext}`);
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

async function captureBrowserDownloadArtifacts(input: {
  beforeFiles: FileStateSnapshot[];
  startedAtMs: number;
  runtimeContext: WorkflowStepRuntimeContext;
  debugLogger: CodeExecutionDebugLogger;
}): Promise<string[]> {
  const { beforeFiles, startedAtMs, runtimeContext, debugLogger } = input;
  const beforeMap = buildFileSnapshotMap(beforeFiles);
  const outputDir = resolveArtifactOutputDir(runtimeContext);
  const detectionDeadline = Date.now() + 5_000;
  let detectedFiles: FileStateSnapshot[] = [];

  while (Date.now() <= detectionDeadline) {
    const currentFiles = await listBrowserDownloadFiles();
    detectedFiles = currentFiles.filter((file) => {
      const previous = beforeMap.get(file.path);
      return (
        (!previous || previous.mtimeMs !== file.mtimeMs || previous.sizeBytes !== file.sizeBytes)
        && file.mtimeMs >= startedAtMs - 2_000
      );
    });

    if (detectedFiles.length > 0) {
      break;
    }

    await sleep(500);
  }

  if (detectedFiles.length === 0) {
    return [];
  }

  await mkdir(outputDir, { recursive: true });

  const copiedPaths: string[] = [];
  for (const file of detectedFiles.sort((left, right) => right.mtimeMs - left.mtimeMs)) {
    try {
      const targetPath = await ensureUniqueCopyTarget(outputDir, file.name);
      await copyFile(file.path, targetPath);
      copiedPaths.push(targetPath);
    } catch (error) {
      debugLogger.warn('download-artifacts', 'Failed to copy downloaded browser file into workflow output', {
        sourcePath: file.path,
        fileName: file.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (copiedPaths.length > 0) {
    debugLogger.info('download-artifacts', 'Captured downloaded browser files into workflow output', {
      copiedFiles: copiedPaths,
    });
  }

  return copiedPaths;
}

async function captureBrowserFailureArtifacts(
  ctx: CodeHandlerContext,
  runtimeContext: WorkflowStepRuntimeContext,
  debugLogger: CodeExecutionDebugLogger,
): Promise<Record<string, string>> {
  if (!ctx.browser.connected) {
    return {};
  }

  const outputDir = resolveArtifactOutputDir(runtimeContext);
  const safeRunId = sanitizePathSegment(runtimeContext.workflowRunId, 'workflow-run');
  const safeStepId = sanitizePathSegment(runtimeContext.stepId, 'agent-step');
  const fileBaseName = `${safeRunId}_${safeStepId}`;
  const artifacts: Record<string, string> = {};
  let currentPage: { id: string; title: string; url: string } | null = null;

  await mkdir(outputDir, { recursive: true });

  try {
    currentPage = await ctx.browser.currentPage();
    if (currentPage.title.trim()) {
      artifacts.browserFailurePageTitle = currentPage.title.trim();
    }
    if (currentPage.url.trim()) {
      artifacts.browserFailurePageUrl = currentPage.url.trim();
    }
  } catch (error) {
    debugLogger.warn('failure-artifacts', 'Failed to capture current page for code failure', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const snapshot = await ctx.browser.snapshot();
    const snapshotPath = path.join(outputDir, `${fileBaseName}_browser-failure-snapshot.txt`);
    await writeFile(snapshotPath, buildFailureSnapshotText({ page: currentPage, snapshot }), 'utf-8');
    artifacts.browserFailureSnapshotPath = snapshotPath;

    if (!artifacts.browserFailurePageTitle && snapshot.title.trim()) {
      artifacts.browserFailurePageTitle = snapshot.title.trim();
    }
    if (!artifacts.browserFailurePageUrl && snapshot.url?.trim()) {
      artifacts.browserFailurePageUrl = snapshot.url.trim();
    }
  } catch (error) {
    debugLogger.warn('failure-artifacts', 'Failed to capture browser snapshot for code failure', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const sourceScreenshotPath = (await ctx.browser.screenshot()).trim();
    if (sourceScreenshotPath) {
      const ext = path.extname(sourceScreenshotPath) || '.png';
      const screenshotPath = path.join(outputDir, `${fileBaseName}_browser-failure-screenshot${ext}`);
      if (path.resolve(sourceScreenshotPath) !== path.resolve(screenshotPath)) {
        await copyFile(sourceScreenshotPath, screenshotPath);
      }
      artifacts.browserFailureScreenshotPath = screenshotPath;
    }
  } catch (error) {
    debugLogger.warn('failure-artifacts', 'Failed to capture browser screenshot for code failure', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (Object.keys(artifacts).length > 0) {
    debugLogger.info('failure-artifacts', 'Captured browser failure artifacts', artifacts);
  }

  return artifacts;
}

class CodeExecutionDebugLogger implements BrowserBridgeDebugLogger {
  private readonly contextLabel: string;
  private entries: DebugLogEntry[] = [];

  constructor(private readonly runtimeContext: WorkflowStepRuntimeContext) {
    this.contextLabel = `${runtimeContext.workflowRunId}/${runtimeContext.stepId}`;
  }

  log(entry: {
    level: DebugLogLevel;
    action: string;
    message: string;
    data?: Record<string, unknown>;
  }): void {
    this.record({
      source: 'browser',
      ...entry,
    });
  }

  info(action: string, message: string, data?: Record<string, unknown>): void {
    this.record({ level: 'info', source: 'code', action, message, data });
  }

  warn(action: string, message: string, data?: Record<string, unknown>): void {
    this.record({ level: 'warn', source: 'code', action, message, data });
  }

  error(action: string, message: string, data?: Record<string, unknown>): void {
    this.record({ level: 'error', source: 'code', action, message, data });
  }

  captureConsole(level: DebugLogLevel, args: unknown[]): void {
    this.record({
      level,
      source: 'console',
      action: 'console',
      message: formatConsoleArgs(args),
    });
  }

  hasBrowserActivity(): boolean {
    return this.entries.some((entry) => entry.source === 'browser');
  }

  async flush(): Promise<string | null> {
    if (this.entries.length === 0) {
      return null;
    }

    const outputDir = resolveArtifactOutputDir(this.runtimeContext);
    const filePath = resolveDebugLogPath(this.runtimeContext);
    const content = this.entries
      .map((entry) => {
        const header = `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.source}:${entry.action} ${entry.message}`;
        if (!entry.data) {
          return header;
        }
        return `${header}\n${serializeForLog(entry.data)}`;
      })
      .join('\n\n')
      .concat('\n');

    await mkdir(outputDir, { recursive: true });
    await appendFile(filePath, content, 'utf-8');
    this.entries = [];
    return filePath;
  }

  private record(entry: Omit<DebugLogEntry, 'timestamp'>): void {
    const normalizedData = normalizeLogData(entry.data);
    const payload: DebugLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
      ...(normalizedData ? { data: normalizedData } : {}),
    };
    this.entries.push(payload);

    const method = payload.level === 'error'
      ? globalThis.console.error
      : payload.level === 'warn'
        ? globalThis.console.warn
        : globalThis.console.info;
    const preview = normalizedData ? ` ${truncateText(serializeForLog(normalizedData), 400)}` : '';
    method.call(
      globalThis.console,
      `[workflow-code][${this.contextLabel}][${payload.source}:${payload.action}] ${payload.message}${preview}`,
    );
  }
}

/**
 * 判断是否应该走代码执行路径
 */
export function shouldExecuteCode(code: AgentStepCodeConfig | undefined): boolean {
  if (!code) return false;
  if ((code.strategy ?? 'code-first') === 'agent-only') return false;
  return Boolean(code.script?.trim() || code.handler);
}

/**
 * 判断代码失败后是否应该回退到 agent
 */
export function shouldFallbackToAgent(code: AgentStepCodeConfig | undefined): boolean {
  if (!code) return false;
  return (code.strategy ?? 'code-first') === 'code-first';
}

function buildHandlerContext(
  input: AgentStepInput,
  runtimeContext: WorkflowStepRuntimeContext,
  code: AgentStepCodeConfig,
  debugLogger: CodeExecutionDebugLogger,
  signal?: AbortSignal,
): CodeHandlerContext {
  return {
    params: code.params ?? {},
    stepId: runtimeContext.stepId,
    workflowRunId: runtimeContext.workflowRunId,
    workingDirectory: runtimeContext.workingDirectory,
    upstreamOutputs: (input.context as Record<string, unknown>) ?? {},
    runtimeContext,
    signal,
    browser: createBrowserBridgeApi({
      signal,
      logger: debugLogger,
      background: true,
    }),
  };
}

function createInlineScriptConsole(debugLogger: CodeExecutionDebugLogger): Console {
  const realConsole = globalThis.console;
  const captured = Object.create(realConsole) as Console & Record<string, unknown>;

  const bind = (level: DebugLogLevel) => (...args: unknown[]) => {
    debugLogger.captureConsole(level, args);
  };

  captured.log = bind('info');
  captured.info = bind('info');
  captured.debug = bind('info');
  captured.warn = bind('warn');
  captured.error = bind('error');
  return captured as Console;
}

/**
 * 执行内联脚本
 * 脚本是一段 async function body，可以使用 ctx 变量，返回 StepResult
 */
async function executeInlineScript(
  script: string,
  ctx: CodeHandlerContext,
  debugLogger: CodeExecutionDebugLogger,
): Promise<StepResult> {
  const fn = new Function('ctx', 'fetch', 'console', `return (async () => { ${script} })()`) as
    (ctx: CodeHandlerContext, fetch: typeof globalThis.fetch, console: Console) => Promise<StepResult>;
  const result = await fn(ctx, globalThis.fetch, createInlineScriptConsole(debugLogger));
  if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
    return { success: true, output: { summary: String(result ?? '') } };
  }
  return result;
}

function attachDebugLogPath(result: StepResult, debugLogPath: string | null): StepResult {
  return attachMetadata(result, { debugLogPath });
}

/**
 * 执行代码处理器（内联脚本或注册的 handler）
 * 返回 null 表示应该继续走 agent 路径
 */
export async function executeCodeHandler(
  input: AgentStepInput,
  runtimeContext: WorkflowStepRuntimeContext,
  signal?: AbortSignal,
): Promise<CodeExecutionOutcome | null> {
  const code = input.code;
  if (!shouldExecuteCode(code)) return null;

  const debugLogger = new CodeExecutionDebugLogger(runtimeContext);
  debugLogger.info('start', 'Starting workflow code execution', {
    strategy: code!.strategy ?? 'code-first',
    hasInlineScript: Boolean(code!.script?.trim()),
    handler: code!.handler ?? null,
  });

  const ctx = buildHandlerContext(input, runtimeContext, code!, debugLogger, signal);
  let outcome: CodeExecutionOutcome | null = null;

  // 优先执行内联脚本
  if (code!.script?.trim()) {
    debugLogger.info('inline-script', 'Running inline workflow script');
    outcome = await runWithFallback(
      code!,
      ctx,
      runtimeContext,
      () => executeInlineScript(code!.script!, ctx, debugLogger),
      debugLogger,
    );
  }

  // 回退到注册的 handler
  if (!outcome && code!.handler) {
    debugLogger.info('handler', 'Running registered code handler', { handler: code!.handler });
    const handler = getCodeHandler(code!.handler);
    if (!handler) {
      const msg = `Code handler "${code!.handler}" not found`;
      debugLogger.error('handler', msg, { handler: code!.handler });
      if ((code!.strategy ?? 'code-first') === 'code-only') {
        outcome = { result: { success: false, output: null, error: msg }, executedVia: 'code', codeError: msg };
      } else {
        debugLogger.warn('fallback', 'Code handler missing, falling back to agent', { handler: code!.handler });
      }
    } else {
      outcome = await runWithFallback(code!, ctx, runtimeContext, () => handler.execute(ctx), debugLogger);
    }
  }

  try {
    const debugLogPath = await debugLogger.flush();
    if (outcome) {
      outcome.result = attachDebugLogPath(outcome.result, debugLogPath);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[code-executor] Failed to persist debug log: ${errorMsg}`);
    if (outcome) {
      outcome.result = attachDebugLogPath(outcome.result, null);
    }
  }

  return outcome;
}

async function runWithFallback(
  code: AgentStepCodeConfig,
  ctx: CodeHandlerContext,
  runtimeContext: WorkflowStepRuntimeContext,
  execute: () => Promise<StepResult>,
  debugLogger: CodeExecutionDebugLogger,
): Promise<CodeExecutionOutcome | null> {
  const startedAtMs = Date.now();
  const beforeDownloadFiles = await listBrowserDownloadFiles();

  try {
    const result = await execute();
    if (result.success) {
      if (shouldCaptureBrowserDownloads(result, debugLogger)) {
        await captureBrowserDownloadArtifacts({
          beforeFiles: beforeDownloadFiles,
          startedAtMs,
          runtimeContext,
          debugLogger,
        });
      }
      debugLogger.info('result', 'Workflow code execution succeeded', {
        summary: summarizeStepResult(result) ?? '',
      });
      return { result, executedVia: 'code' };
    }
    const normalizedResult = ensureFailureError(result);
    const failureArtifacts = await captureBrowserFailureArtifacts(ctx, runtimeContext, debugLogger);
    const resultWithArtifacts = attachMetadata(normalizedResult, failureArtifacts);
    if (!shouldFallbackToAgent(code)) {
      debugLogger.warn('result', 'Workflow code execution returned a failure result', {
        error: resultWithArtifacts.error ?? 'Unknown code execution error',
        summary: summarizeStepResult(resultWithArtifacts) ?? '',
        ...failureArtifacts,
      });
      return { result: resultWithArtifacts, executedVia: 'code', codeError: resultWithArtifacts.error };
    }
    debugLogger.warn('fallback', 'Workflow code execution failed; falling back to agent', {
      error: resultWithArtifacts.error ?? 'Unknown code execution error',
      summary: summarizeStepResult(resultWithArtifacts) ?? '',
      ...failureArtifacts,
    });
    console.warn(`[code-executor] Code failed: ${resultWithArtifacts.error}, falling back to agent`);
    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const failureArtifacts = await captureBrowserFailureArtifacts(ctx, runtimeContext, debugLogger);
    const failureResult = attachMetadata(
      { success: false, output: null, error: errorMsg },
      failureArtifacts,
    );
    debugLogger.error('exception', 'Workflow code execution threw an exception', {
      error: errorMsg,
    });
    if ((code.strategy ?? 'code-first') === 'code-only') {
      return { result: failureResult, executedVia: 'code', codeError: errorMsg };
    }
    debugLogger.warn('fallback', 'Workflow code execution threw; falling back to agent', {
      error: errorMsg,
      ...failureArtifacts,
    });
    console.warn(`[code-executor] Code threw: ${errorMsg}, falling back to agent`);
    return null;
  }
}
