#!/usr/bin/env node
import fs from 'fs';
import http from 'node:http';
import https from 'node:https';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { TOOLS } from './tools.mjs';
import { coerceArgumentsByTools } from '../shared/mcp_args.mjs';

// Long-running ASR jobs (a 51-minute m4a takes 4–8 minutes on most cloud
// providers) routinely exceed Node's default fetch headers timeout of 5 min,
// which is hard-coded inside undici and not adjustable without importing
// undici as a direct dep. We use node:http instead and set our own ceiling
// long enough to cover the largest realistic recording.
const SPEECH_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

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

function callApi(action, args) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(`${API_BASE}/api/speech/${action}`);
    } catch (err) {
      reject(err);
      return;
    }
    const body = JSON.stringify(args ?? {});
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: SPEECH_REQUEST_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let payload = null;
        if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }
        const statusCode = res.statusCode ?? 0;
        const apiSaidNo = payload && payload.ok === false;
        if (statusCode >= 400 || apiSaidNo) {
          const detail = payload?.message
            || payload?.error
            || `Speech API returned ${statusCode || 'no status'}`;
          const msg = payload?.code ? `${payload.code}: ${detail}` : detail;
          reject(new Error(msg));
          return;
        }
        resolve(payload);
      });
      res.on('error', reject);
    });
    req.on('timeout', () => {
      req.destroy(new Error(`Speech API request timed out after ${SPEECH_REQUEST_TIMEOUT_MS / 60_000} min`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const ACTION_FOR_TOOL = {
  transcribe_audio: 'transcribe',
};

function omitText(obj) {
  // Shallow clone without `text`. We intentionally do not deep-walk; the
  // server contract puts the transcript only at the top level.
  const { text: _omit, ...rest } = obj;
  return rest;
}

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
      // For transcribe_audio specifically: the API includes the full
      // transcript as `text` for internal HTTP consumers, but we MUST NOT
      // forward it to the model — that's the whole point of the path-based
      // contract (otherwise a 30k-char transcript lands in tool_result and
      // wipes out the agent context budget). Strip it here.
      const forModel = name === 'transcribe_audio' && result && typeof result === 'object'
        ? omitText(result)
        : result;
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(forModel, null, 2) }] },
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
