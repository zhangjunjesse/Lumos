#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { coerceArgumentsByTools } from '../shared/mcp_args.mjs';

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
    description: [
      'Validate and compile a Workflow DSL v3 spec into a runnable workflow factory module.',
      'v3 is a directed graph: `nodes` are the steps, `edges` define execution order — node array order is irrelevant, only edges decide what runs next.',
      'Edge kinds: "next" (sequential / parallel branch), "then"/"else" (out of an if-else node), "body" (into a for-each/while loop body), "on-error".',
      'Node types: agent, notification, capability, wait, if-else, for-each, while, parallel (pair with join), join, approval.',
      'Returns { code, manifest, validation }. On invalid input it does NOT throw — validation.valid=false with errors.',
      'Minimal example: {"version":"v3","name":"demo","nodes":[{"id":"a","type":"agent","input":{"prompt":"hi"}},{"id":"b","type":"agent","input":{"prompt":"{{ steps.a.output.text }}"}}],"edges":[{"from":"a","to":"b","kind":"next"}]}',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          properties: {
            version: { const: 'v3' },
            name: { type: 'string' },
            description: { type: 'string' },
            nodes: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: [
                      'agent', 'notification', 'capability', 'wait', 'if-else',
                      'for-each', 'while', 'parallel', 'join', 'approval',
                    ],
                  },
                  input: {
                    type: 'object',
                    description: 'Node input; shape depends on type (agent:{prompt}, wait:{durationMs}, if-else:{condition}, for-each:{collection,itemVar}, while:{condition}, approval:{prompt,approvers}). join input is optional.',
                  },
                  outputContract: { type: 'object' },
                  policy: { type: 'object' },
                  onError: { type: 'object' },
                  metadata: { type: 'object' },
                },
                required: ['id', 'type'],
              },
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  from: { type: 'string' },
                  to: { type: 'string' },
                  kind: {
                    type: 'string',
                    enum: ['next', 'then', 'else', 'body', 'on-error'],
                  },
                  branchIndex: { type: 'number' },
                },
                required: ['from', 'to', 'kind'],
              },
            },
            maxDurationMs: { type: 'number' },
          },
          required: ['version', 'name', 'nodes', 'edges'],
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
    const coercedArgs = coerceArgumentsByTools(TOOLS, name, args);
    try {
      if (name === 'generate_workflow') {
        const result = await callGenerateWorkflow(coercedArgs);
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
