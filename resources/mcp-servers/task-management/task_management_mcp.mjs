#!/usr/bin/env node
/**
 * Task Management MCP Server - Native stdio implementation
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const LOG_FILE = path.join(os.homedir(), '.lumos', 'task-management-mcp.log');

function log(msg) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, logMsg);
  } catch (err) {
    // Ignore
  }
  console.error(msg);
}

function getApiBase() {
  if (process.env.LUMOS_API_BASE) return process.env.LUMOS_API_BASE;
  const port = process.env.LUMOS_DEV_SERVER_PORT || process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

const API_BASE = getApiBase();

log('[task-management-mcp] Starting Node.js MCP server (native stdio)');
log(`[task-management-mcp] API_BASE: ${API_BASE}`);

const TOOLS = [
  {
    name: 'createTask',
    description: 'Create a new task in Task Management system',
    inputSchema: {
      type: 'object',
      properties: {
        taskSummary: { type: 'string', description: 'Task summary (third-person)' },
        requirements: { type: 'array', items: { type: 'string' } },
        sessionId: { type: 'string' },
      },
      required: ['taskSummary', 'requirements', 'sessionId'],
    },
  },
  {
    name: 'listTasks',
    description: 'List tasks with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        status: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'getTaskDetail',
    description: 'Get detailed information about a task',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'cancelTask',
    description: 'Cancel a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
];

async function handleRequest(request) {
  const { method, params, id } = request;

  if (method === 'initialize') {
    log('[task-management-mcp] Initialize called');
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'task-management', version: '1.0.0' },
      },
    };
  }

  if (method === 'tools/list') {
    log('[task-management-mcp] tools/list called');
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    log(`[task-management-mcp] Tool called: ${name}`);
    log(`[task-management-mcp] Arguments: ${JSON.stringify(args)}`);

    try {
      let result;
      if (name === 'createTask') {
        result = await callCreateTask(args);
      } else if (name === 'listTasks') {
        result = await callListTasks(args);
      } else if (name === 'getTaskDetail') {
        result = await callGetTaskDetail(args);
      } else if (name === 'cancelTask') {
        result = await callCancelTask(args);
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      log(`[task-management-mcp] Error: ${error.message}`);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: error.message },
      };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}

async function callCreateTask(args) {
  log('[task-management-mcp] Creating task...');
  const response = await fetch(`${API_BASE}/api/task-management/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskSummary: args.taskSummary,
      requirements: args.requirements,
      context: { sessionId: args.sessionId },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    log(`[task-management-mcp] Create task failed: ${error.error}`);
    throw new Error(error.error);
  }

  const result = await response.json();
  log(`[task-management-mcp] Task created: ${result.taskId}`);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

async function callListTasks(args) {
  const params = new URLSearchParams();
  if (args.sessionId) params.append('sessionId', args.sessionId);
  if (args.status) params.append('status', args.status.join(','));

  log(`[task-management-mcp] Listing tasks with params: ${params.toString()}`);
  const response = await fetch(`${API_BASE}/api/task-management/tasks?${params}`);
  if (!response.ok) {
    log(`[task-management-mcp] Failed to list tasks: ${response.status}`);
    throw new Error('Failed to list tasks');
  }

  const result = await response.json();
  log(`[task-management-mcp] List tasks response: ${JSON.stringify(result)}`);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

async function callGetTaskDetail(args) {
  log(`[task-management-mcp] Fetching task detail for: ${args.taskId}`);
  const response = await fetch(`${API_BASE}/api/task-management/tasks/${args.taskId}`);
  if (!response.ok) {
    log(`[task-management-mcp] Failed to get task detail: ${response.status}`);
    throw new Error('Failed to get task detail');
  }

  const result = await response.json();
  log(`[task-management-mcp] Task detail response: ${JSON.stringify(result)}`);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

async function callCancelTask(args) {
  const response = await fetch(`${API_BASE}/api/task-management/${args.taskId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: args.reason }),
  });

  if (!response.ok) throw new Error('Failed to cancel task');

  const result = await response.json();
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}



// Main stdio loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

log('[task-management-mcp] Server started, waiting for requests');

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    const response = await handleRequest(request);
    console.log(JSON.stringify(response));
  } catch (error) {
    log(`[task-management-mcp] Parse error: ${error.message}`);
  }
});

rl.on('close', () => {
  log('[task-management-mcp] Server stopped');
  process.exit(0);
});
