import {
  resolveBrowserBridgeRuntimeConfig,
  postToBrowserBridge,
  getFromBrowserBridge,
} from '@/lib/browser-runtime/bridge-client';
import type { BrowserBridgeApi } from './code-handler-types';

interface PageInfo { id: string; url: string; title: string }
interface SnapshotResult { title: string; content: string; url?: string }
type BrowserBridgeLogLevel = 'info' | 'warn' | 'error';
type BrowserClickTarget = string | { text: string };

// Bridge Server response types (field names differ from BrowserBridgeApi)
interface BridgePageEntry { pageId: string; url: string; title: string }
interface BridgeActionRes { ok?: boolean; pageId?: string }
interface BridgeSnapshotRes extends BridgeActionRes { title?: string; url?: string; lines?: string[] }
interface BridgeScreenshotRes extends BridgeActionRes { filePath?: string }
interface BridgePagesRes { ok?: boolean; pages?: BridgePageEntry[]; activePageId?: string }
interface BridgeCurrentRes { ok?: boolean; page?: BridgePageEntry | null; activePageId?: string }
interface BridgeNewPageRes { ok?: boolean; pageId?: string }
interface BridgeEvaluateRes<T = unknown> extends BridgeActionRes { value?: T; result?: T }

const DEFAULT_NAVIGATE_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 60_000;
const MIN_WAIT_FOR_TIMEOUT_MS = 30_000;
const DIAGNOSTIC_TIMEOUT_MS = 15_000;
const SNAPSHOT_PREVIEW_LINE_LIMIT = 20;
const SNAPSHOT_PREVIEW_CHAR_LIMIT = 1_200;

export interface BrowserBridgeDebugLogger {
  log(entry: {
    level: BrowserBridgeLogLevel;
    action: string;
    message: string;
    data?: Record<string, unknown>;
  }): void;
}

interface CreateBrowserBridgeApiOptions {
  signal?: AbortSignal;
  logger?: BrowserBridgeDebugLogger;
  background?: boolean;
}

function toPageInfo(entry: BridgePageEntry): PageInfo {
  return { id: entry.pageId, url: entry.url, title: entry.title };
}

function normalizeWaitTimeoutMs(timeout?: number): number {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
    return DEFAULT_WAIT_FOR_TIMEOUT_MS;
  }
  return Math.max(timeout, MIN_WAIT_FOR_TIMEOUT_MS);
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function findUidByText(content: string, hint: string): string | null {
  const normalizedHint = normalizeComparableText(hint);
  if (!normalizedHint) {
    return null;
  }

  const pattern = /\[([^\]\s]+)\]([\s\S]*?)(?=\[[^\]\s]+\]|$)/g;
  for (const match of content.matchAll(pattern)) {
    const uid = match[1]?.trim();
    const segment = normalizeComparableText(match[2] ?? '');
    if (uid && segment.includes(normalizedHint)) {
      return uid;
    }
  }

  return null;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 15))}...(省略 ${value.length - maxLength} 字)`;
}

function buildSnapshotPreview(lines: string[] | undefined): string | undefined {
  if (!Array.isArray(lines) || lines.length === 0) {
    return undefined;
  }
  const preview = lines.slice(0, SNAPSHOT_PREVIEW_LINE_LIMIT).join('\n').trim();
  if (!preview) {
    return undefined;
  }
  return truncateText(preview, SNAPSHOT_PREVIEW_CHAR_LIMIT);
}

function redactActionData(action: string, data: Record<string, unknown>): Record<string, unknown> {
  if (action === 'click' && typeof data.target === 'object' && data.target && 'text' in data.target) {
    return {
      ...data,
      target: {
        text: typeof (data.target as { text?: unknown }).text === 'string'
          ? truncateText((data.target as { text: string }).text, 120)
          : '',
      },
    };
  }

  if (action === 'fill') {
    const value = typeof data.value === 'string' ? data.value : '';
    return {
      ...data,
      value: value ? `<redacted:${value.length} chars>` : '<redacted>',
    };
  }

  if (action === 'type') {
    const text = typeof data.text === 'string' ? data.text : '';
    return {
      ...data,
      text: text ? `<redacted:${text.length} chars>` : '<redacted>',
    };
  }

  if (action === 'evaluate') {
    const expression = typeof data.expression === 'string' ? data.expression : '';
    return {
      expressionPreview: expression ? truncateText(expression, 200) : '',
      expressionLength: expression.length,
    };
  }

  return data;
}

function summarizePage(page: PageInfo | null | undefined): string | undefined {
  if (!page) {
    return undefined;
  }

  const parts = [page.title, page.url].map((value) => value?.trim()).filter(Boolean);
  if (parts.length === 0) {
    return page.id || undefined;
  }
  return parts.join(' @ ');
}

function logBridgeEvent(
  logger: BrowserBridgeDebugLogger | undefined,
  entry: {
    level: BrowserBridgeLogLevel;
    action: string;
    message: string;
    data?: Record<string, unknown>;
  },
): void {
  if (!logger) {
    return;
  }
  try {
    logger.log(entry);
  } catch {
    // Ignore secondary logger failures so browser actions still surface the original error.
  }
}

async function collectFailureDiagnostics(input: {
  config: ReturnType<typeof resolveBrowserBridgeRuntimeConfig>;
  boundPageId: string | null;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const { config, boundPageId, signal } = input;
  if (!config) {
    return {};
  }

  const diagnostics: Record<string, unknown> = {};

  try {
    const current = await getFromBrowserBridge<BridgeCurrentRes>(
      config,
      '/v1/pages/current',
      { signal, timeoutMs: DIAGNOSTIC_TIMEOUT_MS },
    );
    if (current.page) {
      diagnostics.currentPage = toPageInfo(current.page);
    }
    if (typeof current.activePageId === 'string' && current.activePageId.trim()) {
      diagnostics.activePageId = current.activePageId;
    }
  } catch (error) {
    diagnostics.currentPageError = error instanceof Error ? error.message : String(error);
  }

  try {
    const snapshot = await postToBrowserBridge<BridgeSnapshotRes>(
      config,
      '/v1/pages/snapshot',
      boundPageId ? { pageId: boundPageId } : {},
      { signal, timeoutMs: DIAGNOSTIC_TIMEOUT_MS },
    );
    if (snapshot.title?.trim()) {
      diagnostics.snapshotTitle = snapshot.title.trim();
    }
    const snapshotPreview = buildSnapshotPreview(snapshot.lines);
    if (snapshotPreview) {
      diagnostics.snapshotPreview = snapshotPreview;
    }
  } catch (error) {
    diagnostics.snapshotError = error instanceof Error ? error.message : String(error);
  }

  return diagnostics;
}

function buildEnrichedErrorMessage(
  action: string,
  error: unknown,
  diagnostics: Record<string, unknown>,
  boundPageId: string | null,
): string {
  const message = error instanceof Error ? error.message : String(error);
  const parts = [message, `action=${action}`];

  if (boundPageId) {
    parts.push(`boundPageId=${boundPageId}`);
  }

  const currentPage = diagnostics.currentPage as PageInfo | undefined;
  const currentPageSummary = summarizePage(currentPage);
  if (currentPageSummary) {
    parts.push(`currentPage=${currentPageSummary}`);
  }

  if (typeof diagnostics.activePageId === 'string' && diagnostics.activePageId.trim()) {
    parts.push(`activePageId=${diagnostics.activePageId}`);
  }

  if (typeof diagnostics.snapshotTitle === 'string' && diagnostics.snapshotTitle.trim()) {
    parts.push(`snapshotTitle=${diagnostics.snapshotTitle}`);
  }

  if (typeof diagnostics.snapshotPreview === 'string' && diagnostics.snapshotPreview.trim()) {
    parts.push(`snapshotPreview=${truncateText(diagnostics.snapshotPreview, 400)}`);
  }

  return parts.join(' | ');
}

/**
 * 创建 BrowserBridgeApi 实例
 * 封装 Bridge Server HTTP 调用，代码脚本通过 ctx.browser 使用
 * 与 Agent 的 Chrome DevTools MCP 共享同一个浏览器实例和登录态
 *
 * 注意：Bridge Server 的 click/fill 使用 uid（来自 snapshot），
 * waitFor 等待的是页面文本（不是 CSS selector）
 */
export function createBrowserBridgeApi(options: CreateBrowserBridgeApiOptions = {}): BrowserBridgeApi {
  const config = resolveBrowserBridgeRuntimeConfig();
  const { signal, logger, background } = options;

  if (!config) {
    return createDisconnectedApi(logger);
  }

  let boundPageId: string | null = null;

  const rememberPageId = (pageId: unknown) => {
    if (typeof pageId === 'string' && pageId.trim()) {
      boundPageId = pageId;
    }
  };

  const clearBoundPageId = (pageId: string) => {
    if (boundPageId === pageId) {
      boundPageId = null;
    }
  };

  const withBoundPageId = <T extends Record<string, unknown>>(body: T): T & { pageId?: string } => (
    {
      ...body,
      ...(boundPageId ? { pageId: boundPageId } : {}),
      ...(background ? { background: true } : {}),
    }
  );

  const resolveClickUid = async (target: BrowserClickTarget): Promise<string> => {
    if (typeof target === 'string') {
      return target;
    }

    const targetText = target?.text?.trim();
    if (!targetText) {
      throw new Error('click target.text 不能为空');
    }

    const snapshot = await runBridgeAction({
      action: 'snapshotForClickTarget',
      requestData: { targetText },
      execute: () => postToBrowserBridge<BridgeSnapshotRes>(
        config,
        '/v1/pages/snapshot',
        withBoundPageId({}),
        { signal },
      ),
      summarizeResult: (result) => ({
        ...(result.pageId ? { pageId: result.pageId } : {}),
        ...(result.title ? { title: result.title } : {}),
      }),
    });
    rememberPageId(snapshot.pageId);

    const content = Array.isArray(snapshot.lines) ? snapshot.lines.join('\n') : '';
    const uid = findUidByText(content, targetText);
    if (!uid) {
      throw new Error(`未能从页面快照中找到文本为 "${targetText}" 的可点击元素`);
    }

    logBridgeEvent(logger, {
      level: 'info',
      action: 'resolveClickTarget',
      message: 'resolved text target to uid',
      data: {
        targetText,
        uid,
        ...(boundPageId ? { boundPageId } : {}),
      },
    });
    return uid;
  };

  const runBridgeAction = async <T>(input: {
    action: string;
    requestData?: Record<string, unknown>;
    execute: () => Promise<T>;
    summarizeResult?: (result: T) => Record<string, unknown> | undefined;
    collectDiagnostics?: boolean;
  }): Promise<T> => {
    const requestData = input.requestData ? redactActionData(input.action, input.requestData) : undefined;
    logBridgeEvent(logger, {
      level: 'info',
      action: input.action,
      message: 'start',
      data: {
        ...(requestData ?? {}),
        ...(boundPageId ? { boundPageId } : {}),
        ...(background ? { background: true } : {}),
      },
    });

    try {
      const result = await input.execute();
      logBridgeEvent(logger, {
        level: 'info',
        action: input.action,
        message: 'success',
        data: {
          ...(input.summarizeResult?.(result) ?? {}),
          ...(boundPageId ? { boundPageId } : {}),
          ...(background ? { background: true } : {}),
        },
      });
      return result;
    } catch (error) {
      const diagnostics = input.collectDiagnostics === false
        ? {}
        : await collectFailureDiagnostics({ config, boundPageId, signal });
      logBridgeEvent(logger, {
        level: 'error',
        action: input.action,
        message: error instanceof Error ? error.message : String(error),
        data: {
          ...(requestData ?? {}),
          ...(boundPageId ? { boundPageId } : {}),
          ...(background ? { background: true } : {}),
          ...diagnostics,
        },
      });
      throw new Error(buildEnrichedErrorMessage(input.action, error, diagnostics, boundPageId));
    }
  };

  return {
    connected: true,

    async navigate(url: string) {
      const res = await runBridgeAction({
        action: 'navigate',
        requestData: { url, type: 'url' },
        execute: () => postToBrowserBridge<BridgeActionRes>(
          config,
          '/v1/pages/navigate',
          withBoundPageId({ url, type: 'url' }),
          { signal, timeoutMs: DEFAULT_NAVIGATE_TIMEOUT_MS },
        ),
        summarizeResult: (result) => (
          result.pageId ? { pageId: result.pageId } : undefined
        ),
      });
      rememberPageId(res.pageId);
    },

    async click(target: BrowserClickTarget) {
      const uid = await resolveClickUid(target);
      const res = await runBridgeAction({
        action: 'click',
        requestData: { target, uid },
        execute: () => postToBrowserBridge<BridgeActionRes>(
          config,
          '/v1/pages/click',
          withBoundPageId({ uid }),
          { signal },
        ),
        summarizeResult: (result) => (
          result.pageId ? { pageId: result.pageId } : undefined
        ),
      });
      rememberPageId(res.pageId);
    },

    async fill(uid: string, value: string) {
      const res = await runBridgeAction({
        action: 'fill',
        requestData: { uid, value },
        execute: () => postToBrowserBridge<BridgeActionRes>(
          config,
          '/v1/pages/fill',
          withBoundPageId({ uid, value }),
          { signal },
        ),
        summarizeResult: (result) => (
          result.pageId ? { pageId: result.pageId } : undefined
        ),
      });
      rememberPageId(res.pageId);
    },

    async type(text: string, submitKey?: string) {
      const res = await runBridgeAction({
        action: 'type',
        requestData: {
          text,
          ...(submitKey ? { submitKey } : {}),
        },
        execute: () => postToBrowserBridge<BridgeActionRes>(
          config,
          '/v1/pages/type',
          withBoundPageId({
            text,
            ...(submitKey ? { submitKey } : {}),
          }),
          { signal },
        ),
        summarizeResult: (result) => (
          result.pageId ? { pageId: result.pageId } : undefined
        ),
      });
      rememberPageId(res.pageId);
    },

    async press(key: string) {
      const res = await runBridgeAction({
        action: 'press',
        requestData: { key },
        execute: () => postToBrowserBridge<BridgeActionRes>(
          config,
          '/v1/pages/press',
          withBoundPageId({ key }),
          { signal },
        ),
        summarizeResult: (result) => (
          result.pageId ? { pageId: result.pageId } : undefined
        ),
      });
      rememberPageId(res.pageId);
    },

    async waitFor(texts: string | string[], options?: { timeout?: number }) {
      const textArray = Array.isArray(texts) ? texts : [texts];
      const timeoutMs = normalizeWaitTimeoutMs(options?.timeout);
      const res = await runBridgeAction({
        action: 'waitFor',
        requestData: {
          text: textArray,
          timeoutMs,
        },
        execute: () => postToBrowserBridge<BridgeActionRes>(
          config,
          '/v1/pages/wait-for',
          withBoundPageId({
            text: textArray,
            timeoutMs,
          }),
          {
            signal,
            timeoutMs,
          },
        ),
        summarizeResult: (result) => (
          result.pageId ? { pageId: result.pageId } : undefined
        ),
      });
      rememberPageId(res.pageId);
    },

    async evaluate<T = unknown>(script: string): Promise<T> {
      const res = await runBridgeAction({
        action: 'evaluate',
        requestData: { expression: script },
        execute: () => postToBrowserBridge<BridgeEvaluateRes<T>>(
          config,
          '/v1/pages/evaluate',
          withBoundPageId({ expression: script }),
          { signal },
        ),
        summarizeResult: (result) => (
          result.pageId ? { pageId: result.pageId } : undefined
        ),
      });
      rememberPageId(res.pageId);
      return (res.value ?? res.result) as T;
    },

    async snapshot(): Promise<SnapshotResult> {
      const res = await runBridgeAction({
        action: 'snapshot',
        execute: () => postToBrowserBridge<BridgeSnapshotRes>(
          config,
          '/v1/pages/snapshot',
          withBoundPageId({}),
          { signal },
        ),
        summarizeResult: (result) => ({
          ...(result.pageId ? { pageId: result.pageId } : {}),
          ...(result.title ? { title: result.title } : {}),
          lineCount: Array.isArray(result.lines) ? result.lines.length : 0,
        }),
      });
      rememberPageId(res.pageId);
      const content = Array.isArray(res.lines) ? res.lines.join('\n') : '';
      return { title: res.title ?? '', content, url: res.url ?? '' };
    },

    async screenshot(): Promise<string> {
      const res = await runBridgeAction({
        action: 'screenshot',
        execute: () => postToBrowserBridge<BridgeScreenshotRes>(
          config,
          '/v1/pages/screenshot',
          withBoundPageId({}),
          { signal },
        ),
        summarizeResult: (result) => ({
          ...(result.pageId ? { pageId: result.pageId } : {}),
          ...(result.filePath ? { filePath: result.filePath } : {}),
        }),
      });
      rememberPageId(res.pageId);
      return res.filePath ?? '';
    },

    async pages(): Promise<PageInfo[]> {
      const res = await runBridgeAction({
        action: 'pages',
        collectDiagnostics: false,
        execute: () => getFromBrowserBridge<BridgePagesRes>(config, '/v1/pages', { signal }),
        summarizeResult: (result) => ({
          pageCount: Array.isArray(result.pages) ? result.pages.length : 0,
          ...(result.activePageId ? { activePageId: result.activePageId } : {}),
        }),
      });
      if (!boundPageId) {
        rememberPageId(res.activePageId);
      }
      return (res.pages ?? []).map(toPageInfo);
    },

    async currentPage(): Promise<PageInfo> {
      const res = await runBridgeAction({
        action: 'currentPage',
        collectDiagnostics: false,
        execute: () => getFromBrowserBridge<BridgeCurrentRes>(config, '/v1/pages/current', { signal }),
        summarizeResult: (result) => ({
          ...(result.activePageId ? { activePageId: result.activePageId } : {}),
          ...(result.page ? { currentPage: summarizePage(toPageInfo(result.page)) } : {}),
        }),
      });
      rememberPageId(res.page?.pageId ?? res.activePageId);
      return res.page ? toPageInfo(res.page) : { id: '', url: '', title: '' };
    },

    async newPage(url?: string): Promise<{ id: string }> {
      const res = await runBridgeAction({
        action: 'newPage',
        requestData: { ...(url ? { url } : {}) },
        execute: () => postToBrowserBridge<BridgeNewPageRes>(
          config,
          '/v1/pages/new',
          {
            ...(url ? { url } : {}),
            ...(background ? { background: true } : {}),
          },
          { signal },
        ),
        summarizeResult: (result) => (
          result.pageId ? { pageId: result.pageId } : undefined
        ),
      });
      rememberPageId(res.pageId);
      return { id: res.pageId ?? '' };
    },

    async selectPage(id: string) {
      await runBridgeAction({
        action: 'selectPage',
        requestData: { pageId: id },
        execute: () => postToBrowserBridge(
          config,
          '/v1/pages/select',
          {
            pageId: id,
            ...(background ? { background: true } : {}),
          },
          { signal },
        ),
      });
      rememberPageId(id);
    },

    async closePage(id: string) {
      await runBridgeAction({
        action: 'closePage',
        requestData: { pageId: id },
        execute: () => postToBrowserBridge(
          config,
          '/v1/pages/close',
          {
            pageId: id,
            ...(background ? { background: true } : {}),
          },
          { signal },
        ),
      });
      clearBoundPageId(id);
    },
  };
}

function createDisconnectedApi(logger?: BrowserBridgeDebugLogger): BrowserBridgeApi {
  const err = () => {
    logBridgeEvent(logger, {
      level: 'error',
      action: 'bridge',
      message: 'Browser bridge 未连接，请确认 Electron 桌面端已启动',
    });
    throw new Error('Browser bridge 未连接，请确认 Electron 桌面端已启动');
  };
  return {
    connected: false,
    navigate: err, click: err, fill: err, type: err, press: err,
    waitFor: err, evaluate: err, snapshot: err, screenshot: err,
    pages: err, currentPage: err, newPage: err, selectPage: err, closePage: err,
  };
}
