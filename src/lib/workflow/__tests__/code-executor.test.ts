import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  clearCodeHandlersForTests,
  registerCodeHandler,
} from '../code-handler-registry';
import type { BrowserBridgeApi } from '../code-handler-types';
import * as codeBrowserBridge from '../code-browser-bridge';
import { executeCodeHandler } from '../code-executor';
import type { AgentStepInput, WorkflowStepRuntimeContext } from '../types';

function makeInput(overrides: Partial<AgentStepInput> = {}): AgentStepInput {
  return { prompt: 'test prompt', ...overrides };
}

function makeRuntimeContext(overrides: Partial<WorkflowStepRuntimeContext> = {}): WorkflowStepRuntimeContext {
  return {
    workflowRunId: 'wf-run-1',
    stepId: 'step-1',
    stepType: 'agent',
    ...overrides,
  };
}

beforeEach(() => {
  clearCodeHandlersForTests();
});

describe('executeCodeHandler', () => {
  let previousDataDir: string | undefined;
  let previousDownloadsDir: string | undefined;
  let tempDataDir: string;
  let tempDownloadsDir: string;

  beforeEach(() => {
    previousDataDir = process.env.LUMOS_DATA_DIR;
    previousDownloadsDir = process.env.LUMOS_BROWSER_DOWNLOADS_DIR;
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-code-executor-test-'));
    tempDownloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-code-downloads-test-'));
    process.env.LUMOS_DATA_DIR = tempDataDir;
    process.env.LUMOS_BROWSER_DOWNLOADS_DIR = tempDownloadsDir;
  });

  afterEach(() => {
    if (previousDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = previousDataDir;
    }
    if (previousDownloadsDir === undefined) {
      delete process.env.LUMOS_BROWSER_DOWNLOADS_DIR;
    } else {
      process.env.LUMOS_BROWSER_DOWNLOADS_DIR = previousDownloadsDir;
    }
    jest.restoreAllMocks();
    fs.rmSync(tempDataDir, { recursive: true, force: true });
    fs.rmSync(tempDownloadsDir, { recursive: true, force: true });
  });
  it('returns null when no code config', async () => {
    const result = await executeCodeHandler(makeInput(), makeRuntimeContext());
    expect(result).toBeNull();
  });

  it('returns null when strategy is agent-only', async () => {
    const input = makeInput({
      code: { handler: 'test', strategy: 'agent-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());
    expect(result).toBeNull();
  });

  it('code-only: returns success when handler succeeds', async () => {
    registerCodeHandler({
      id: 'test-ok',
      name: 'Test OK',
      execute: async () => ({
        success: true,
        output: { data: 'hello' },
      }),
    });

    const input = makeInput({
      code: { handler: 'test-ok', strategy: 'code-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.executedVia).toBe('code');
    expect(result!.result.success).toBe(true);
    expect(result!.result.output).toEqual({ data: 'hello' });
  });

  it('code-only: returns failure when handler fails (no fallback)', async () => {
    registerCodeHandler({
      id: 'test-fail',
      name: 'Test Fail',
      execute: async () => ({
        success: false,
        output: null,
        error: 'download failed',
      }),
    });

    const input = makeInput({
      code: { handler: 'test-fail', strategy: 'code-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.executedVia).toBe('code');
    expect(result!.result.success).toBe(false);
    expect(result!.result.error).toBe('download failed');
  });

  it('code-only: returns failure when handler throws (no fallback)', async () => {
    registerCodeHandler({
      id: 'test-throw',
      name: 'Test Throw',
      execute: async () => {
        throw new Error('unexpected crash');
      },
    });

    const input = makeInput({
      code: { handler: 'test-throw', strategy: 'code-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.executedVia).toBe('code');
    expect(result!.result.success).toBe(false);
    expect(result!.result.error).toBe('unexpected crash');
  });

  it('code-first: returns success when handler succeeds', async () => {
    registerCodeHandler({
      id: 'test-ok',
      name: 'Test OK',
      execute: async () => ({
        success: true,
        output: { result: 42 },
      }),
    });

    const input = makeInput({
      code: { handler: 'test-ok', strategy: 'code-first' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.executedVia).toBe('code');
    expect(result!.result.success).toBe(true);
  });

  it('code-first: returns null (fallback to agent) when handler fails', async () => {
    registerCodeHandler({
      id: 'test-fail',
      name: 'Test Fail',
      execute: async () => ({
        success: false,
        output: null,
        error: 'page not found',
      }),
    });

    const input = makeInput({
      code: { handler: 'test-fail', strategy: 'code-first' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).toBeNull();
  });

  it('code-first: returns null (fallback to agent) when handler throws', async () => {
    registerCodeHandler({
      id: 'test-throw',
      name: 'Test Throw',
      execute: async () => {
        throw new Error('network error');
      },
    });

    const input = makeInput({
      code: { handler: 'test-throw', strategy: 'code-first' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).toBeNull();
  });

  it('code-first is the default strategy', async () => {
    registerCodeHandler({
      id: 'test-fail',
      name: 'Test Fail',
      execute: async () => ({
        success: false,
        output: null,
        error: 'failed',
      }),
    });

    const input = makeInput({
      code: { handler: 'test-fail' }, // no strategy → defaults to code-first
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    // code-first + failure → null (fallback to agent)
    expect(result).toBeNull();
  });

  it('code-only: returns error when handler not found', async () => {
    const input = makeInput({
      code: { handler: 'nonexistent', strategy: 'code-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.result.success).toBe(false);
    expect(result!.result.error).toContain('not found');
  });

  it('code-first: returns null when handler not found (fallback)', async () => {
    const input = makeInput({
      code: { handler: 'nonexistent', strategy: 'code-first' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).toBeNull();
  });

  it('passes params and upstream outputs to handler', async () => {
    let receivedCtx: unknown = null;
    registerCodeHandler({
      id: 'ctx-check',
      name: 'Context Check',
      execute: async (ctx) => {
        receivedCtx = ctx;
        return { success: true, output: null };
      },
    });

    const input = makeInput({
      code: {
        handler: 'ctx-check',
        params: { dateRange: '2026-03' },
        strategy: 'code-only',
      },
      context: { upstream: 'some data' },
    });
    const rtx = makeRuntimeContext({ stepId: 'download' });
    await executeCodeHandler(input, rtx);

    const ctx = receivedCtx as Record<string, unknown>;
    expect(ctx.params).toEqual({ dateRange: '2026-03' });
    expect(ctx.stepId).toBe('download');
    expect(ctx.upstreamOutputs).toEqual({ upstream: 'some data' });
  });

  it('creates the workflow browser api in background mode by default', async () => {
    const mockBrowser: BrowserBridgeApi = {
      connected: true,
      navigate: async () => undefined,
      click: async () => undefined,
      fill: async () => undefined,
      type: async () => undefined,
      press: async () => undefined,
      waitFor: async () => undefined,
      evaluate: async () => undefined,
      pages: async () => [],
      newPage: async () => ({ id: 'page-hidden' }),
      selectPage: async () => undefined,
      closePage: async () => undefined,
      currentPage: async () => ({ id: 'page-hidden', title: '', url: '' }),
      snapshot: async () => ({ title: '', content: '', url: '' }),
      screenshot: async () => '',
    };
    const createBrowserBridgeApiSpy = jest
      .spyOn(codeBrowserBridge, 'createBrowserBridgeApi')
      .mockReturnValue(mockBrowser);

    registerCodeHandler({
      id: 'background-browser-check',
      name: 'Background Browser Check',
      execute: async () => ({
        success: true,
        output: { summary: 'ok' },
      }),
    });

    await executeCodeHandler(
      makeInput({
        code: { handler: 'background-browser-check', strategy: 'code-only' },
      }),
      makeRuntimeContext(),
    );

    expect(createBrowserBridgeApiSpy).toHaveBeenCalledWith(expect.objectContaining({
      background: true,
    }));
  });

  it('persists inline script debug logs into the workflow step output directory', async () => {
    const runtimeContext = makeRuntimeContext({
      workflowRunId: 'wf-run-logs',
      stepId: 'step-inline-log',
    });

    const result = await executeCodeHandler(
      makeInput({
        code: {
          strategy: 'code-only',
          script: `
            console.log('wishlist start', { section: 'favorites' });
            return {
              success: true,
              output: { summary: 'inline script ok' },
            };
          `,
        },
      }),
      runtimeContext,
    );

    expect(result).not.toBeNull();
    expect(result!.result.metadata).toMatchObject({
      debugLogPath: expect.stringContaining('wf-run-logs_step-inline-log_code-debug.log'),
    });

    const debugLogPath = (result!.result.metadata as Record<string, unknown>).debugLogPath as string;
    expect(fs.existsSync(debugLogPath)).toBe(true);
    const content = fs.readFileSync(debugLogPath, 'utf-8');
    expect(content).toContain('INFO code:start Starting workflow code execution');
    expect(content).toContain('INFO console:console wishlist start');
    expect(content).toContain('INFO code:result Workflow code execution succeeded');
  });

  it('captures browser failure artifacts and promotes summary to error for failed code-only scripts', async () => {
    const screenshotSourcePath = path.join(tempDataDir, 'source-failure.png');
    fs.writeFileSync(screenshotSourcePath, 'fake-png');

    const mockBrowser: BrowserBridgeApi = {
      connected: true,
      navigate: async () => undefined,
      click: async () => undefined,
      fill: async () => undefined,
      type: async () => undefined,
      press: async () => undefined,
      waitFor: async () => undefined,
      evaluate: async () => undefined,
      pages: async () => [],
      newPage: async () => ({ id: 'page-wishlist' }),
      selectPage: async () => undefined,
      closePage: async () => undefined,
      currentPage: async () => ({
        id: 'page-wishlist',
        title: 'My Saved Items',
        url: 'https://www.gigab2b.com/index.php?route=account/wishlist',
      }),
      snapshot: async () => ({
        title: 'My Saved Items',
        url: 'https://www.gigab2b.com/index.php?route=account/wishlist',
        content: '[e21] Download Data\n[e22] Export CSV',
      }),
      screenshot: async () => screenshotSourcePath,
    };

    jest.spyOn(codeBrowserBridge, 'createBrowserBridgeApi').mockReturnValue(mockBrowser);

    const result = await executeCodeHandler(
      makeInput({
        code: {
          strategy: 'code-only',
          script: `
            return {
              success: false,
              output: {
                summary: '点击下载数据按钮失败: 未能从页面快照中找到文本为 "下载数据" 的可点击元素',
              },
            };
          `,
        },
      }),
      makeRuntimeContext({
        workflowRunId: 'wf-run-failure-artifacts',
        stepId: 'download-data',
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.result.success).toBe(false);
    expect(result!.result.error).toBe('点击下载数据按钮失败: 未能从页面快照中找到文本为 "下载数据" 的可点击元素');
    expect(result!.result.metadata).toMatchObject({
      browserFailurePageTitle: 'My Saved Items',
      browserFailurePageUrl: 'https://www.gigab2b.com/index.php?route=account/wishlist',
      browserFailureSnapshotPath: expect.stringContaining('wf-run-failure-artifacts_download-data_browser-failure-snapshot.txt'),
      browserFailureScreenshotPath: expect.stringContaining('wf-run-failure-artifacts_download-data_browser-failure-screenshot.png'),
      debugLogPath: expect.stringContaining('wf-run-failure-artifacts_download-data_code-debug.log'),
    });

    const metadata = result!.result.metadata as Record<string, string>;
    expect(fs.existsSync(metadata.browserFailureSnapshotPath)).toBe(true);
    expect(fs.existsSync(metadata.browserFailureScreenshotPath)).toBe(true);
    expect(fs.existsSync(metadata.debugLogPath)).toBe(true);
    expect(fs.readFileSync(metadata.browserFailureSnapshotPath, 'utf-8')).toContain('[e21] Download Data');
    expect(fs.readFileSync(metadata.browserFailureSnapshotPath, 'utf-8')).toContain('URL: https://www.gigab2b.com/index.php?route=account/wishlist');
  });

  it('copies newly downloaded browser files into the workflow step output directory on success', async () => {
    registerCodeHandler({
      id: 'test-download-success',
      name: 'Test Download Success',
      execute: async () => {
        fs.writeFileSync(path.join(tempDownloadsDir, '产品信息下载_全部 20260404(1).xlsx'), 'fake-excel');
        return {
          success: true,
          output: { summary: '文件下载完成' },
        };
      },
    });

    const result = await executeCodeHandler(
      makeInput({
        code: { handler: 'test-download-success', strategy: 'code-only' },
      }),
      makeRuntimeContext({
        workflowRunId: 'wf-run-download-success',
        stepId: 'download-data',
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.result.success).toBe(true);

    const copiedFilePath = path.join(
      tempDataDir,
      'workflow-agent-runs',
      'wf-run-download-success',
      'stages',
      'download-data',
      'output',
      '产品信息下载_全部 20260404(1).xlsx',
    );

    expect(fs.existsSync(copiedFilePath)).toBe(true);
    expect(fs.readFileSync(copiedFilePath, 'utf-8')).toBe('fake-excel');
  });
});
