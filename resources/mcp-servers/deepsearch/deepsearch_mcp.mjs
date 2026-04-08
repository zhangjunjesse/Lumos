#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const LOG_FILE = path.join(os.homedir(), '.lumos', 'deepsearch-mcp.log');

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // ignore logging failures
  }
  console.error(message);
}

function getApiBase() {
  if (process.env.LUMOS_API_BASE) return process.env.LUMOS_API_BASE;
  const port = process.env.LUMOS_DEV_SERVER_PORT || process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

const API_BASE = getApiBase();

const TOOLS = [
  {
    name: 'start',
    description: 'Start a DeepSearch run to search and extract content from supported sites. Supported sites: zhihu (知乎), wechat (微信公众号, via Baidu), xiaohongshu (小红书), juejin (掘金), x (Twitter/X). When user asks to search any of these platforms, use this tool. WeChat articles are publicly accessible — no login required.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Research query or topic to search for.' },
        sites: { type: 'array', items: { type: 'string' }, description: 'Target site keys: zhihu, wechat, xiaohongshu, juejin, x. If omitted, auto-detected from query or all ready sites used.' },
        goal: {
          type: 'string',
          enum: ['browse', 'evidence', 'full-content', 'research-report'],
        },
        pageMode: {
          type: 'string',
          enum: ['takeover_active_page', 'managed_page'],
        },
        strictness: {
          type: 'string',
          enum: ['strict', 'best_effort'],
        },
        maxPages: { type: 'integer', minimum: 1 },
        maxDepth: { type: 'integer', minimum: 1 },
        keepEvidence: { type: 'boolean' },
        keepScreenshots: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_result',
    description: 'Read current DeepSearch run status, summary, captured record snippets, and artifact references.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'pause',
    description: 'Pause a running or pending DeepSearch run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'resume',
    description: 'Resume a paused or waiting-login DeepSearch run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'cancel',
    description: 'Cancel a DeepSearch run that has not reached a terminal state.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'fetch_account_data',
    description: 'Fetch personal account data from a supported site using the logged-in session. Currently supports zhihu browse_history (知乎浏览历史，需已登录). Returns a list of recently viewed items with title, url, type, and viewedAt.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site key, e.g. "zhihu"',
          enum: ['zhihu'],
        },
        type: {
          type: 'string',
          description: 'Data type to fetch, e.g. "browse_history"',
          enum: ['browse_history'],
        },
        limit: {
          type: 'integer',
          description: 'Max number of items to return (default 20, max 100)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['site', 'type'],
    },
  },
];

async function callDeepSearchTool(name, args) {
  const body = {
    action: name,
    ...args,
  };

  if (name === 'start') {
    body.requestedBySessionId = process.env.LUMOS_SESSION_ID || null;
  }

  const response = await fetch(`${API_BASE}/api/deepsearch/tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage = payload && typeof payload.error === 'string'
      ? payload.error
      : `DeepSearch API returned ${response.status}`;
    throw new Error(errorMessage);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(payload?.result ?? payload) }],
  };
}

async function handleRequest(request) {
  const { method, params, id } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'deepsearch', version: '1.0.0' },
      },
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS },
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      if (!TOOLS.some((tool) => tool.name === name)) {
        throw new Error(`Unknown tool: ${name}`);
      }
      const result = await callDeepSearchTool(name, args);
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found' },
  };
}

async function startStdioServer() {
  log('[deepsearch-mcp] Starting Node.js MCP server');
  log(`[deepsearch-mcp] API_BASE: ${API_BASE}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    try {
      const request = JSON.parse(line);
      const response = await handleRequest(request);
      console.log(JSON.stringify(response));
    } catch (error) {
      log(`[deepsearch-mcp] Parse error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  rl.on('close', () => {
    log('[deepsearch-mcp] Server stopped');
    process.exit(0);
  });
}

if (
  process.env.LUMOS_DEEPSEARCH_MCP_NO_STDIN !== '1'
  && process.argv[1]
  && path.resolve(process.argv[1]) === __filename
) {
  void startStdioServer();
}
