#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const LOG_FILE = path.join(os.homedir(), '.lumos', 'workflow-mcp.log');

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

export const TOOLS = [
  {
    name: 'generate_workflow',
    description: 'Validate and compile Workflow DSL v1 into a workflow factory module',
    inputSchema: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          properties: {
            version: { const: 'v1' },
            name: { type: 'string' },
            steps: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: ['agent', 'browser', 'notification'],
                  },
                  dependsOn: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  when: { type: 'object' },
                  input: { type: 'object' },
                  policy: { type: 'object' },
                },
                required: ['id', 'type'],
              },
            },
          },
          required: ['version', 'name', 'steps'],
        },
      },
      required: ['spec'],
    },
  },
];

export async function callGenerateWorkflow(args) {
  const response = await fetch(`${API_BASE}/api/workflow/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage = payload && typeof payload.error === 'string'
      ? payload.error
      : `Workflow API returned ${response.status}`;
    throw new Error(errorMessage);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

export async function handleRequest(request) {
  const { method, params, id } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'workflow', version: '1.0.0' },
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
      if (name === 'generate_workflow') {
        const result = await callGenerateWorkflow(args);
        return { jsonrpc: '2.0', id, result };
      }

      throw new Error(`Unknown tool: ${name}`);
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
  log('[workflow-mcp] Starting Node.js MCP server');
  log(`[workflow-mcp] API_BASE: ${API_BASE}`);

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
      log(`[workflow-mcp] Parse error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  rl.on('close', () => {
    log('[workflow-mcp] Server stopped');
    process.exit(0);
  });
}

if (
  process.env.LUMOS_WORKFLOW_MCP_NO_STDIN !== '1'
  && process.argv[1]
  && path.resolve(process.argv[1]) === __filename
) {
  void startStdioServer();
}
