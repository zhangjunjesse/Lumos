import { randomUUID } from 'crypto';
import { mkdir, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  type BrowserBridgeRuntimeConfig,
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
} from '../browser-bridge-client';
import type {
  BrowserStepInput,
  StepResult,
  WorkflowStepRuntimeContext,
} from '../types';

interface BrowserBridgeNavigateResponse {
  ok: true;
  pageId: string;
}

interface BrowserBridgeCreatePageResponse {
  ok: true;
  pageId: string;
}

interface BrowserBridgeSnapshotResponse {
  ok: true;
  pageId: string;
  url?: string;
  title?: string;
  lines?: string[];
}

interface BrowserBridgeEvaluateResponse {
  ok: true;
  pageId: string;
  value?: {
    ok?: boolean;
    error?: string;
    [key: string]: unknown;
  };
}

interface BrowserBridgeScreenshotResponse {
  ok: true;
  pageId: string;
  filePath: string;
}

function getConfiguredDataDir(): string {
  return process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function getDefaultRuntimeContext(): WorkflowStepRuntimeContext {
  return {
    workflowRunId: `workflow-run-${randomUUID()}`,
    stepId: `browser-step-${randomUUID().slice(0, 8)}`,
    stepType: 'browser',
  };
}

function getWorkflowBrowserRootDir(): string {
  return path.join(getConfiguredDataDir(), 'workflow-browser-runs');
}

function buildMetadata(
  runtimeContext: WorkflowStepRuntimeContext,
  executionMode: 'browser-bridge' | 'synthetic',
  extras?: Record<string, string | null>,
): Record<string, string | null> {
  return {
    workflowRunId: runtimeContext.workflowRunId,
    stepId: runtimeContext.stepId,
    executionMode,
    ...extras,
  };
}

function buildSyntheticResult(
  input: BrowserStepInput,
  runtimeContext: WorkflowStepRuntimeContext,
): StepResult {
  return {
    success: true,
    output: {
      action: input.action,
      url: input.url ?? null,
      selector: input.selector ?? null,
      value: input.value ?? null,
      pageId: null,
      title: null,
      result: `Synthetic ${input.action} completed`,
      timestamp: new Date().toISOString(),
    },
    metadata: buildMetadata(runtimeContext, 'synthetic', {
      bridgeSource: null,
    }),
  };
}

function buildClickExpression(selector: string): string {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const element = document.querySelector(selector);
    if (!(element instanceof Element)) {
      return { ok: false, error: 'SELECTOR_NOT_FOUND', selector };
    }

    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.click();
    } else {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }

    return {
      ok: true,
      selector,
      tagName: element.tagName.toLowerCase(),
      text: String(element.textContent || '').trim().slice(0, 120),
    };
  })()`;
}

function buildFillExpression(selector: string, value: string): string {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const value = ${JSON.stringify(value)};
    const element = document.querySelector(selector);
    if (!(element instanceof Element)) {
      return { ok: false, error: 'SELECTOR_NOT_FOUND', selector };
    }

    const dispatch = (target, type) => {
      target.dispatchEvent(new Event(type, { bubbles: true }));
    };

    if (
      element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
    ) {
      element.focus();
      element.value = value;
      dispatch(element, 'input');
      dispatch(element, 'change');
      if (element instanceof HTMLElement) {
        element.blur();
      }
      return {
        ok: true,
        selector,
        tagName: element.tagName.toLowerCase(),
        valueLength: value.length,
      };
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      element.focus();
      element.textContent = value;
      dispatch(element, 'input');
      dispatch(element, 'change');
      element.blur();
      return {
        ok: true,
        selector,
        tagName: element.tagName.toLowerCase(),
        valueLength: value.length,
      };
    }

    return {
      ok: false,
      error: 'SELECTOR_NOT_FILLABLE',
      selector,
      tagName: element.tagName.toLowerCase(),
    };
  })()`;
}

async function capturePageSummary(
  bridgeConfig: BrowserBridgeRuntimeConfig,
  pageId: string,
): Promise<{
  pageId: string;
  url: string | null;
  title: string | null;
  lines: string[];
}> {
  const snapshot = await postToBrowserBridge<BrowserBridgeSnapshotResponse>(
    bridgeConfig,
    '/v1/pages/snapshot',
    { pageId },
  );

  return {
    pageId: snapshot.pageId,
    url: snapshot.url ?? null,
    title: snapshot.title ?? null,
    lines: Array.from(
      new Set(
        (Array.isArray(snapshot.lines) ? snapshot.lines : [])
          .map((line) => (typeof line === 'string' ? line.trim() : ''))
          .filter(Boolean),
      ),
    ).slice(0, 20),
  };
}

async function buildScreenshotFilePath(runtimeContext: WorkflowStepRuntimeContext): Promise<string> {
  const rootDir = getWorkflowBrowserRootDir();
  const safeRunId = sanitizePathSegment(runtimeContext.workflowRunId, 'workflow-run');
  const safeStepId = sanitizePathSegment(runtimeContext.stepId, 'browser-step');
  const stepDir = path.join(rootDir, safeRunId, 'screenshots');
  await mkdir(stepDir, { recursive: true });
  return path.join(stepDir, `${safeStepId}.png`);
}

export async function browserStep(input: BrowserStepInput): Promise<StepResult> {
  const runtimeContext = input.__runtime ?? getDefaultRuntimeContext();
  const bridgeConfig = resolveBrowserBridgeRuntimeConfig();

  if (!bridgeConfig) {
    return buildSyntheticResult(input, runtimeContext);
  }

  try {
    switch (input.action) {
      case 'navigate': {
        const navigate = input.createPage
          ? await postToBrowserBridge<BrowserBridgeCreatePageResponse>(
              bridgeConfig,
              '/v1/pages/new',
              { url: input.url },
            )
          : await postToBrowserBridge<BrowserBridgeNavigateResponse>(
              bridgeConfig,
              '/v1/pages/navigate',
              {
                url: input.url,
                ...(input.pageId ? { pageId: input.pageId } : {}),
              },
            );
        const summary = await capturePageSummary(bridgeConfig, navigate.pageId);
        return {
          success: true,
          output: {
            action: input.action,
            pageId: summary.pageId,
            url: summary.url ?? input.url ?? null,
            title: summary.title,
            lines: summary.lines,
            selector: null,
            value: null,
          },
          metadata: buildMetadata(runtimeContext, 'browser-bridge', {
            bridgeSource: bridgeConfig.source,
          }),
        };
      }
      case 'click': {
        const evaluate = await postToBrowserBridge<BrowserBridgeEvaluateResponse>(
          bridgeConfig,
          '/v1/pages/evaluate',
          {
            expression: buildClickExpression(input.selector!),
            ...(input.pageId ? { pageId: input.pageId } : {}),
          },
        );
        if (!evaluate.value?.ok) {
          throw new Error(typeof evaluate.value?.error === 'string' ? evaluate.value.error : 'BROWSER_CLICK_FAILED');
        }
        const summary = await capturePageSummary(bridgeConfig, evaluate.pageId);
        return {
          success: true,
          output: {
            action: input.action,
            pageId: summary.pageId,
            url: summary.url,
            title: summary.title,
            lines: summary.lines,
            selector: input.selector ?? null,
            value: null,
            element: evaluate.value,
          },
          metadata: buildMetadata(runtimeContext, 'browser-bridge', {
            bridgeSource: bridgeConfig.source,
          }),
        };
      }
      case 'fill': {
        const evaluate = await postToBrowserBridge<BrowserBridgeEvaluateResponse>(
          bridgeConfig,
          '/v1/pages/evaluate',
          {
            expression: buildFillExpression(input.selector!, input.value ?? ''),
            ...(input.pageId ? { pageId: input.pageId } : {}),
          },
        );
        if (!evaluate.value?.ok) {
          throw new Error(typeof evaluate.value?.error === 'string' ? evaluate.value.error : 'BROWSER_FILL_FAILED');
        }
        const summary = await capturePageSummary(bridgeConfig, evaluate.pageId);
        return {
          success: true,
          output: {
            action: input.action,
            pageId: summary.pageId,
            url: summary.url,
            title: summary.title,
            lines: summary.lines,
            selector: input.selector ?? null,
            value: input.value ?? null,
            element: evaluate.value,
          },
          metadata: buildMetadata(runtimeContext, 'browser-bridge', {
            bridgeSource: bridgeConfig.source,
          }),
        };
      }
      case 'screenshot': {
        const filePath = await buildScreenshotFilePath(runtimeContext);
        const screenshot = await postToBrowserBridge<BrowserBridgeScreenshotResponse>(
          bridgeConfig,
          '/v1/pages/screenshot',
          {
            filePath,
            ...(input.pageId ? { pageId: input.pageId } : {}),
          },
        );
        const [summary, imageBuffer] = await Promise.all([
          capturePageSummary(bridgeConfig, screenshot.pageId),
          readFile(screenshot.filePath),
        ]);
        return {
          success: true,
          output: {
            action: input.action,
            pageId: summary.pageId,
            url: summary.url,
            title: summary.title,
            lines: summary.lines,
            screenshotPath: screenshot.filePath,
            screenshotBase64: imageBuffer.toString('base64'),
          },
          metadata: buildMetadata(runtimeContext, 'browser-bridge', {
            bridgeSource: bridgeConfig.source,
          }),
        };
      }
      default: {
        throw new Error(`Unsupported browser action: ${String(input.action)}`);
      }
    }
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: buildMetadata(runtimeContext, 'browser-bridge', {
        bridgeSource: bridgeConfig.source,
      }),
    };
  }
}
