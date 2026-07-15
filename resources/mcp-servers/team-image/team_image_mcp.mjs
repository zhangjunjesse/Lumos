#!/usr/bin/env node
// 团队出图 stdio MCP(平台通用):把 generate_image 转发到 Lumos 的团队出图回调 API。
//
// 为什么存在:进程内 SDK MCP server / canUseTool 都走 SDK↔CLI 控制协议,复杂多子代理
// 会话里该往返会断(Stream closed)。stdio 进程由 CLI 直接管,与控制协议无关。
// 配额与产出路径追踪在服务端(team-image-service),本进程只做纯转发。

import readline from 'readline';

const API_BASE = process.env.LUMOS_API_BASE
  || `http://localhost:${process.env.LUMOS_DEV_SERVER_PORT || process.env.PORT || '3000'}`;
const RUN_TOKEN = process.env.LUMOS_TEAM_RUN_TOKEN || '';
// 单次批量出图可达数分钟;给足但仍要兜底,防止 API 侧悬死拖垮整队。
const CALL_TIMEOUT_MS = 15 * 60 * 1000;

const GENERATE_IMAGE_TOOL = {
  name: 'generate_image',
  description: 'Generate images using AI. Call this tool when the user asks to '
    + 'generate, draw, create, edit, restyle, or transform images.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed English description of the image to generate. '
          + 'For editing tasks, describe only the requested changes. '
          + 'IMPORTANT: Do NOT embed absolute file paths (e.g. `/Users/.../foo.jpg`) in this field. '
          + 'If the task references local image files, pass every path via `reference_image_paths` '
          + 'and describe them here by position only (e.g. "Image 1", "Image 2").',
      },
      aspect_ratio: {
        type: 'string',
        enum: ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'],
        description: 'Aspect ratio. Defaults to 1:1.',
      },
      image_size: {
        type: 'string',
        enum: ['1K', '2K', '4K'],
        description: 'Resolution. 1K=1024px, 2K=2048px, 4K=4096px (pro model only). Defaults to 1K.',
      },
      count: {
        type: 'integer', minimum: 1, maximum: 4,
        description: 'Number of images to generate (1-4). Defaults to 1.',
      },
      reference_image_paths: {
        type: 'array', items: { type: 'string' },
        description: 'Local file paths of reference images (absolute paths). '
          + 'REQUIRED whenever the task mentions absolute image paths — the paths go HERE, not in `prompt`.',
      },
      enable_sequential: {
        type: 'boolean',
        description: 'Enable sequential group mode for character/style-consistent multi-image generation.',
      },
      color_palette: {
        type: 'string',
        description: "Hex color palette to control image colors, e.g. '#FF5733,#33FF57,#3357FF'.",
      },
      negative_prompt: {
        type: 'string',
        description: 'Describe what to EXCLUDE from the image, e.g. "no text, no watermark, no blur".',
      },
    },
    required: ['prompt'],
  },
};

async function callApi(args) {
  const response = await fetch(`${API_BASE}/api/team/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RUN_TOKEN, args }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  if (!payload || !Array.isArray(payload.content)) {
    throw new Error(`团队出图 API 返回异常 (HTTP ${response.status})`);
  }
  return payload; // 已是 CallToolResult 形状 { content, isError? }
}

async function handleRequest(request) {
  const { method, params, id } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'lumos-image', version: '1.0.0' },
      },
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: [GENERATE_IMAGE_TOOL] } };
  }
  if (method === 'tools/call') {
    try {
      if (params?.name !== 'generate_image') throw new Error(`unknown tool: ${params?.name}`);
      return { jsonrpc: '2.0', id, result: await callApi(params.arguments || {}) };
    } catch (error) {
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: String(error?.message || error) }) }],
          isError: true,
        },
      };
    }
  }
  if (id === undefined) return null; // 其他通知直接忽略
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let request;
  try {
    request = JSON.parse(text);
  } catch {
    return;
  }
  const response = await handleRequest(request).catch((error) => ({
    jsonrpc: '2.0', id: request.id,
    error: { code: -32603, message: String(error?.message || error) },
  }));
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
});
