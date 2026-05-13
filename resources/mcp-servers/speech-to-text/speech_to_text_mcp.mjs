#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { TOOLS } from './tools.mjs';
import { coerceArgumentsByTools } from '../shared/mcp_args.mjs';

const LOG_FILE = path.join(os.homedir(), '.lumos', 'speech-to-text-mcp.log');

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
  console.error(message);
}

function getApiBase() {
  if (process.env.LUMOS_API_BASE) return process.env.LUMOS_API_BASE;
  const port = process.env.LUMOS_DEV_SERVER_PORT || process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

const API_BASE = getApiBase();

async function callApi(action, args) {
  const response = await fetch(`${API_BASE}/api/speech/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || (payload && payload.ok === false)) {
    const detail = payload?.message
      || payload?.error
      || `Speech API returned ${response.status}`;
    const msg = payload?.code ? `${payload.code}: ${detail}` : detail;
    throw new Error(msg);
  }
  return payload;
}

const ACTION_FOR_TOOL = {
  transcribe_audio: 'transcribe',
};

async function handleRequest(request) {
  const { method, params, id } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'speech-to-text', version: '1.0.0' },
      },
    };
  }

  if (method === 'notifications/initialized') return null;

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    const action = ACTION_FOR_TOOL[name];
    if (!action) {
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: `Error: unknown tool ${name}` }],
          isError: true,
        },
      };
    }
    try {
      const result = await callApi(action, coerceArgumentsByTools(TOOLS, name, args));
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      };
    } catch (error) {
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        },
      };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}

async function startStdioServer() {
  log('[speech-to-text-mcp] Starting');
  log(`[speech-to-text-mcp] API_BASE: ${API_BASE}`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on('line', async (line) => {
    try {
      const request = JSON.parse(line);
      const response = await handleRequest(request);
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    } catch (error) {
      log(`[speech-to-text-mcp] Parse error: ${error.message}`);
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32700, message: 'Parse error' },
      }) + '\n');
    }
  });

  rl.on('close', () => {
    log('[speech-to-text-mcp] stdin closed, exiting');
    process.exit(0);
  });
}

startStdioServer();
