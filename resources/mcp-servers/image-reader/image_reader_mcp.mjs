#!/usr/bin/env node
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { coerceArgumentsByTools } from '../shared/mcp_args.mjs';

const LOG_FILE = path.join(os.homedir(), '.lumos', 'image-reader-mcp.log');

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const TOOLS = [
  {
    name: 'read_image',
    description:
      'Load an image file (JPEG/PNG/WebP/GIF) into the conversation as a visual content block the model can actually see. Use this instead of read_file or any generic file reader — generic readers return base64 text that explodes the token budget and cannot be viewed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the image file, or a path relative to the current workspace.',
        },
      },
      required: ['path'],
    },
  },
];

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fsSync.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
  console.error(message);
}

function resolveInputPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error('path must be a non-empty string');
  }
  const trimmed = rawPath.trim();
  if (path.isAbsolute(trimmed)) return trimmed;
  const workspace = process.env.WORKSPACE_PATH?.trim() || process.cwd();
  return path.resolve(workspace, trimmed);
}

async function readImage(rawPath) {
  const absPath = resolveInputPath(rawPath);
  const ext = path.extname(absPath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    throw new Error(
      `Unsupported image type: ${ext || '(none)'}. Supported: ${Object.keys(MIME_BY_EXT).join(', ')}`,
    );
  }

  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    throw new Error(`Cannot access ${absPath}: ${err.code || err.message}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Not a regular file: ${absPath}`);
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    const actual = (stat.size / 1024 / 1024).toFixed(2);
    const max = MAX_IMAGE_BYTES / 1024 / 1024;
    throw new Error(
      `Image too large: ${actual}MB (max ${max}MB). ` +
        'Resize or compress before reading. Claude vision rejects single images above ~5MB base64.',
    );
  }

  const buffer = await fs.readFile(absPath);
  return {
    data: buffer.toString('base64'),
    mimeType,
    sizeBytes: stat.size,
    path: absPath,
  };
}

async function handleRequest(request) {
  const { method, params, id } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'image-reader', version: '1.0.0' },
      },
    };
  }

  if (method === 'notifications/initialized') return null;

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    if (name !== 'read_image') {
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true },
      };
    }
    try {
      const coercedArgs = coerceArgumentsByTools(TOOLS, name, args);
      const { data, mimeType, sizeBytes, path: absPath } = await readImage(coercedArgs.path);
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [
            { type: 'image', data, mimeType },
            { type: 'text', text: `Loaded ${absPath} (${mimeType}, ${(sizeBytes / 1024).toFixed(1)}KB).` },
          ],
        },
      };
    } catch (error) {
      log(`[image-reader-mcp] read_image error: ${error.message}`);
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
  log('[image-reader-mcp] Starting');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on('line', async (line) => {
    try {
      const request = JSON.parse(line);
      const response = await handleRequest(request);
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    } catch (error) {
      log(`[image-reader-mcp] Parse error: ${error.message}`);
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32700, message: 'Parse error' },
      }) + '\n');
    }
  });

  rl.on('close', () => {
    log('[image-reader-mcp] stdin closed, exiting');
    process.exit(0);
  });
}

startStdioServer();
