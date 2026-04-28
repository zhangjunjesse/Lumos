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

const TOOL_NAMES = new Set([
  'start',
  'get_result',
  'pause',
  'resume',
  'cancel',
  'fetch_account_data',
]);

async function loadToolManifest() {
  try {
    const response = await fetch(`${API_BASE}/api/deepsearch/tool-manifest`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.sites)) {
      throw new Error('invalid manifest payload');
    }
    return data;
  } catch (error) {
    log(`[deepsearch-mcp] loadToolManifest failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function buildStartTool(manifest) {
  const sites = manifest && Array.isArray(manifest.sites) ? manifest.sites : [];

  let description;
  let sitesItemSchema;
  if (sites.length > 0) {
    const formattedList = sites
      .map((s) => `${s.siteKey} (${s.displayName}${s.loginRequired ? ', login required' : ', no login'})`)
      .join('; ');
    description = `Start a DeepSearch run to search and extract content from a registered site. Available sites: ${formattedList}. When the user mentions any of these sources, use this tool. Sites marked "no login" are always usable; "login required" sites need cookies configured in the DeepSearch settings panel.`;
    sitesItemSchema = { type: 'string', enum: sites.map((s) => s.siteKey) };
  } else {
    description = 'Start a DeepSearch run to search and extract content from a registered site. The site list could not be loaded right now; pass a human-readable query and let the server pick ready sites automatically.';
    sitesItemSchema = { type: 'string' };
  }

  return {
    name: 'start',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Research query or topic to search for.' },
        sites: {
          type: 'array',
          items: sitesItemSchema,
          description: 'Optional. Target site keys; if omitted, the server auto-detects from query or uses all ready sites.',
        },
        goal: { type: 'string', enum: ['browse', 'evidence', 'full-content', 'research-report'] },
        pageMode: { type: 'string', enum: ['takeover_active_page', 'managed_page'] },
        strictness: { type: 'string', enum: ['strict', 'best_effort'] },
        maxPages: { type: 'integer', minimum: 1 },
        maxDepth: { type: 'integer', minimum: 1 },
        keepEvidence: { type: 'boolean' },
        keepScreenshots: { type: 'boolean' },
      },
      required: ['query'],
    },
  };
}

function buildFetchAccountDataTool(manifest) {
  const entries = manifest && Array.isArray(manifest.accountDataSites) ? manifest.accountDataSites : [];

  let description;
  let siteSchema;
  let typeSchema;
  if (entries.length > 0) {
    const summary = entries
      .map((entry) => `${entry.siteKey}: ${(entry.types || []).join('/')}`)
      .join('; ');
    const allKeys = entries.map((entry) => entry.siteKey);
    const allTypes = Array.from(new Set(entries.flatMap((entry) => entry.types || [])));
    description = `Fetch personal account data from a logged-in site. Currently supported: ${summary}. Returns recent items with title, url, type, and viewedAt.`;
    siteSchema = { type: 'string', description: 'Site key', enum: allKeys };
    typeSchema = { type: 'string', description: 'Data type', enum: allTypes };
  } else {
    description = 'Fetch personal account data from a logged-in site. The supported list could not be loaded; the server will reject unsupported site/type combinations.';
    siteSchema = { type: 'string', description: 'Site key' };
    typeSchema = { type: 'string', description: 'Data type' };
  }

  return {
    name: 'fetch_account_data',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        site: siteSchema,
        type: typeSchema,
        limit: {
          type: 'integer',
          description: 'Max number of items to return (default 20, max 100)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['site', 'type'],
    },
  };
}

const STATIC_TOOLS = [
  {
    name: 'get_result',
    description: 'Read current DeepSearch run status, summary, captured record snippets, and artifact references.',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'string' } },
      required: ['runId'],
    },
  },
  {
    name: 'pause',
    description: 'Pause a running or pending DeepSearch run.',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'string' } },
      required: ['runId'],
    },
  },
  {
    name: 'resume',
    description: 'Resume a paused or waiting-login DeepSearch run.',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'string' } },
      required: ['runId'],
    },
  },
  {
    name: 'cancel',
    description: 'Cancel a DeepSearch run that has not reached a terminal state.',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'string' } },
      required: ['runId'],
    },
  },
];

async function buildTools() {
  const manifest = await loadToolManifest();
  return [
    buildStartTool(manifest),
    ...STATIC_TOOLS,
    buildFetchAccountDataTool(manifest),
  ];
}

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
    const tools = await buildTools();
    return {
      jsonrpc: '2.0',
      id,
      result: { tools },
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      if (!TOOL_NAMES.has(name)) {
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
