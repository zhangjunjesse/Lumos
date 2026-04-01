#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_WAIT_TIMEOUT_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

async function loadSdk() {
  const sdkRoots = Array.from(new Set([
    path.resolve(__dirname, '..', '..', 'feishu-mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk'),
    path.resolve(process.cwd(), 'resources', 'feishu-mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk'),
    typeof process.resourcesPath === 'string'
      ? path.resolve(process.resourcesPath, 'feishu-mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk')
      : '',
  ].filter(Boolean)));

  const entryCandidates = [];
  for (const sdkRoot of sdkRoots) {
    entryCandidates.push({
      serverPath: path.join(sdkRoot, 'server', 'index.js'),
      stdioPath: path.join(sdkRoot, 'server', 'stdio.js'),
      typesPath: path.join(sdkRoot, 'types.js'),
    });
    entryCandidates.push({
      serverPath: path.join(sdkRoot, 'dist', 'esm', 'server', 'index.js'),
      stdioPath: path.join(sdkRoot, 'dist', 'esm', 'server', 'stdio.js'),
      typesPath: path.join(sdkRoot, 'dist', 'esm', 'types.js'),
    });
  }

  const checkedPaths = [];
  for (const candidate of entryCandidates) {
    const { serverPath, stdioPath, typesPath } = candidate;
    checkedPaths.push(serverPath);
    if (!fs.existsSync(serverPath) || !fs.existsSync(stdioPath) || !fs.existsSync(typesPath)) {
      continue;
    }

    try {
      const [{ Server }, { StdioServerTransport }, typesMod] = await Promise.all([
        import(pathToFileURL(serverPath).href),
        import(pathToFileURL(stdioPath).href),
        import(pathToFileURL(typesPath).href),
      ]);
      return {
        Server,
        StdioServerTransport,
        ListToolsRequestSchema: typesMod.ListToolsRequestSchema,
        CallToolRequestSchema: typesMod.CallToolRequestSchema,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown import error';
      console.error('[lumos-chrome-mcp] Failed to import MCP SDK candidate:', serverPath, reason);
    }
  }

  throw new Error(`MCP SDK not found. Checked candidates:\n- ${checkedPaths.join('\n- ')}`);
}

function toolResponse(payload, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function getBridgeConfig() {
  const baseUrl = pickNonEmpty(process.env.LUMOS_BROWSER_BRIDGE_URL);
  const token = pickNonEmpty(process.env.LUMOS_BROWSER_BRIDGE_TOKEN);
  return { baseUrl, token };
}

async function callBridge(pathname, options = {}) {
  const { baseUrl, token } = getBridgeConfig();
  if (!baseUrl || !token) {
    throw new Error(
      'Browser bridge is not configured. Missing LUMOS_BROWSER_BRIDGE_URL or LUMOS_BROWSER_BRIDGE_TOKEN.'
    );
  }

  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-lumos-bridge-token': token,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    const error = json?.error || `HTTP_${res.status}`;
    throw new Error(`Bridge request failed (${pathname}): ${error}`);
  }

  return json;
}

function isRetryableBridgeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /INTERNAL_ERROR|WAIT_FOR_TIMEOUT|CAPTURE_SCREENSHOT_FAILED|UID_NOT_FOUND|NO_ACTIVE_ELEMENT|target closed|CDP command failed/i.test(message);
}

async function refreshActivePageId(previousPageId) {
  try {
    const pages = await callBridge('/v1/pages');
    const list = Array.isArray(pages?.pages) ? pages.pages : [];
    if (previousPageId && list.some((page) => page?.pageId === previousPageId)) {
      return previousPageId;
    }
    return normalizePageId(pages?.activePageId);
  } catch {
    return normalizePageId(previousPageId);
  }
}

async function withBridgeRetry(run, options = {}) {
  try {
    return await run(options.pageId);
  } catch (error) {
    if (!isRetryableBridgeError(error)) {
      throw error;
    }

    await sleep(typeof options.delayMs === 'number' ? options.delayMs : 500);
    const recoveredPageId = await refreshActivePageId(options.pageId);
    return run(recoveredPageId);
  }
}

function normalizePageId(raw) {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

async function handleTool(name, args) {
  switch (name) {
    case 'list_pages': {
      return callBridge('/v1/pages');
    }

    case 'new_page': {
      const url = typeof args?.url === 'string' ? args.url : '';
      const created = await withBridgeRetry(
        () => callBridge('/v1/pages/new', {
          method: 'POST',
          body: { url: url || undefined },
        }),
        { delayMs: 700 },
      );
      const pages = await callBridge('/v1/pages');
      return { ...created, pages: pages.pages, activePageId: pages.activePageId };
    }

    case 'select_page': {
      const pageId = normalizePageId(args?.pageId);
      if (!pageId) throw new Error('select_page requires pageId');
      await withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/select', {
          method: 'POST',
          body: { pageId: resolvedPageId || pageId },
        }),
        { pageId },
      );
      return callBridge('/v1/pages');
    }

    case 'close_page': {
      const pageId = normalizePageId(args?.pageId);
      if (!pageId) throw new Error('close_page requires pageId');
      await callBridge('/v1/pages/close', { method: 'POST', body: { pageId } });
      return callBridge('/v1/pages');
    }

    case 'navigate_page': {
      const pageId = normalizePageId(args?.pageId);
      const type = typeof args?.type === 'string' ? args.type : 'url';
      const url = typeof args?.url === 'string' ? args.url : undefined;
      return withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/navigate', {
          method: 'POST',
          body: { pageId: resolvedPageId, type, url },
        }),
        { pageId, delayMs: 700 },
      );
    }

    case 'take_snapshot': {
      const pageId = normalizePageId(args?.pageId);
      const snapshot = await withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/snapshot', {
          method: 'POST',
          body: { pageId: resolvedPageId },
        }),
        { pageId, delayMs: 700 },
      );
      const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
      return {
        pageId: snapshot.pageId,
        url: snapshot.url,
        title: snapshot.title,
        snapshot: [`URL: ${snapshot.url}`, `Title: ${snapshot.title}`, '', ...lines].join('\n'),
      };
    }

    case 'click': {
      const uid = typeof args?.uid === 'string' ? args.uid : '';
      if (!uid) throw new Error('click requires uid');
      const pageId = normalizePageId(args?.pageId);
      return withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/click', {
          method: 'POST',
          body: { pageId: resolvedPageId, uid },
        }),
        { pageId },
      );
    }

    case 'fill': {
      const uid = typeof args?.uid === 'string' ? args.uid : '';
      if (!uid) throw new Error('fill requires uid');
      const pageId = normalizePageId(args?.pageId);
      const value = typeof args?.value === 'string' ? args.value : '';
      return withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/fill', {
          method: 'POST',
          body: { pageId: resolvedPageId, uid, value },
        }),
        { pageId },
      );
    }

    case 'type_text': {
      const text = typeof args?.text === 'string' ? args.text : '';
      if (!text) throw new Error('type_text requires text');
      const pageId = normalizePageId(args?.pageId);
      const submitKey = typeof args?.submitKey === 'string' ? args.submitKey : undefined;
      return withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/type', {
          method: 'POST',
          body: { pageId: resolvedPageId, text, submitKey },
        }),
        { pageId },
      );
    }

    case 'press_key': {
      const key = typeof args?.key === 'string' ? args.key : '';
      if (!key) throw new Error('press_key requires key');
      const pageId = normalizePageId(args?.pageId);
      return withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/press', {
          method: 'POST',
          body: { pageId: resolvedPageId, key },
        }),
        { pageId },
      );
    }

    case 'wait_for': {
      const text = Array.isArray(args?.text) ? args.text.filter((v) => typeof v === 'string' && v.trim()) : [];
      if (text.length === 0) throw new Error('wait_for requires non-empty text[]');
      const timeoutMs = typeof args?.timeout === 'number' ? args.timeout : DEFAULT_WAIT_TIMEOUT_MS;
      const pageId = normalizePageId(args?.pageId);
      return withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/wait-for', {
          method: 'POST',
          body: { pageId: resolvedPageId, text, timeoutMs },
        }),
        { pageId, delayMs: 700 },
      );
    }

    case 'evaluate_script': {
      const expression = typeof args?.expression === 'string' ? args.expression : '';
      if (!expression) throw new Error('evaluate_script requires expression');
      const pageId = normalizePageId(args?.pageId);
      return withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/evaluate', {
          method: 'POST',
          body: { pageId: resolvedPageId, expression },
        }),
        { pageId },
      );
    }

    case 'take_screenshot': {
      const pageId = normalizePageId(args?.pageId);
      const filePath = typeof args?.filePath === 'string' ? args.filePath : undefined;
      return withBridgeRetry(
        (resolvedPageId) => callBridge('/v1/pages/screenshot', {
          method: 'POST',
          body: { pageId: resolvedPageId, filePath },
        }),
        { pageId, delayMs: 700 },
      );
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main() {
  const sdk = await loadSdk();
  const { Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema } = sdk;

  const server = new Server(
    { name: 'chrome-devtools', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_pages',
        description: 'List available browser pages in Lumos built-in browser context.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'new_page',
        description: 'Create and activate a new page. Optional url.',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string' } },
        },
      },
      {
        name: 'select_page',
        description: 'Switch active page by pageId.',
        inputSchema: {
          type: 'object',
          properties: { pageId: { type: 'string' } },
          required: ['pageId'],
        },
      },
      {
        name: 'close_page',
        description: 'Close page by pageId.',
        inputSchema: {
          type: 'object',
          properties: { pageId: { type: 'string' } },
          required: ['pageId'],
        },
      },
      {
        name: 'navigate_page',
        description: 'Navigate active/selected page. type=url|back|forward|reload.',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            type: { type: 'string', enum: ['url', 'back', 'forward', 'reload'] },
            url: { type: 'string' },
          },
        },
      },
      {
        name: 'take_snapshot',
        description: 'Take a text snapshot of current page and assign uids for interactive elements.',
        inputSchema: {
          type: 'object',
          properties: { pageId: { type: 'string' } },
        },
      },
      {
        name: 'click',
        description: 'Click element by uid from latest snapshot.',
        inputSchema: {
          type: 'object',
          properties: { pageId: { type: 'string' }, uid: { type: 'string' } },
          required: ['uid'],
        },
      },
      {
        name: 'fill',
        description: 'Fill input-like element by uid.',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            uid: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['uid', 'value'],
        },
      },
      {
        name: 'type_text',
        description: 'Type text into currently focused element. Optional submitKey.',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            text: { type: 'string' },
            submitKey: { type: 'string' },
          },
          required: ['text'],
        },
      },
      {
        name: 'press_key',
        description: 'Press key on currently focused element.',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            key: { type: 'string' },
          },
          required: ['key'],
        },
      },
      {
        name: 'wait_for',
        description: 'Wait until any provided text appears on page.',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            text: { type: 'array', items: { type: 'string' } },
            timeout: { type: 'number' },
          },
          required: ['text'],
        },
      },
      {
        name: 'evaluate_script',
        description: 'Evaluate JavaScript expression in page context and return value.',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            expression: { type: 'string' },
          },
          required: ['expression'],
        },
      },
      {
        name: 'take_screenshot',
        description: 'Capture screenshot of page and save to local path.',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            filePath: { type: 'string' },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request?.params?.name;
    const args = request?.params?.arguments || {};
    if (!name) return toolResponse({ error: 'Missing tool name' }, true);
    try {
      const result = await handleTool(name, args);
      return toolResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolResponse({ error: message }, true);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[lumos-chrome-mcp] server started');
}

main().catch((error) => {
  console.error('[lumos-chrome-mcp] fatal error:', error);
  process.exit(1);
});
