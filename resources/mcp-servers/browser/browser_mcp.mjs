#!/usr/bin/env node
/**
 * Lumos Browser MCP Server
 *
 * 通过 bridge-server HTTP API 控制 Lumos 内置浏览器。
 * 天然共享用户登录态，无需额外认证配置。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

const LOG_FILE = path.join(os.homedir(), '.lumos', 'browser-mcp.log');
const BRIDGE_RUNTIME_FILE = path.join(os.homedir(), '.lumos', 'runtime', 'browser-bridge.json');

// When set to '1', all browser operations run in background mode:
// tabs are never switched to and the browser UI is not disturbed.
// Set LUMOS_BROWSER_HEADLESS=1 in the MCP env config for agent/workflow use.
const HEADLESS = process.env.LUMOS_BROWSER_HEADLESS === '1';

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
  console.error(message);
}

/** 读取 bridge 服务地址和 token */
function getBridgeConfig() {
  const url = process.env.LUMOS_BROWSER_BRIDGE_URL;
  const token = process.env.LUMOS_BROWSER_BRIDGE_TOKEN;
  if (url && token) return { url, token };
  try {
    const data = JSON.parse(fs.readFileSync(BRIDGE_RUNTIME_FILE, 'utf-8'));
    if (data.url && data.token) return { url: data.url, token: data.token };
  } catch { /* file not ready */ }
  return null;
}

async function callBridge(method, pathname, body) {
  const config = getBridgeConfig();
  if (!config) throw new Error('浏览器 bridge 未就绪，请确认 Lumos 已启动');

  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-lumos-bridge-token': config.token,
    },
  };
  if (body !== undefined) options.body = JSON.stringify(body);

  const res = await fetch(`${config.url}${pathname}`, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Bridge returned ${res.status}`);
  }
  return json;
}

const TOOLS = [
  {
    name: 'browser_list_pages',
    description: '列出所有打开的浏览器标签页，返回 pageId、标题、URL 等信息。在调用其他工具前先用此工具获取 pageId。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_open_page',
    description: '打开新标签页并导航到指定 URL。返回新页面的 pageId。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要打开的网页地址' },
        background: { type: 'boolean', description: '是否在后台打开（不切换到该标签），默认 false' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_navigate',
    description: '在指定页面执行导航操作：跳转 URL、后退、前进或刷新。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '目标页面 ID，使用 browser_list_pages 获取' },
        type: { type: 'string', enum: ['url', 'back', 'forward', 'reload'], description: '导航类型，默认 url' },
        url: { type: 'string', description: '当 type 为 url 时必填' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'browser_snapshot',
    description: '获取页面的可交互元素列表（带 uid）和页面文本摘要。用于分析页面结构和找到可点击/输入的元素。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '目标页面 ID' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'browser_click',
    description: '点击页面中的元素。需要先用 browser_snapshot 获取元素的 uid。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '目标页面 ID' },
        uid: { type: 'string', description: '元素 uid，从 browser_snapshot 结果中获取' },
      },
      required: ['pageId', 'uid'],
    },
  },
  {
    name: 'browser_type',
    description: '向当前聚焦的输入框输入文本。可选择按 Enter 或 Tab 提交。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '目标页面 ID' },
        text: { type: 'string', description: '要输入的文字' },
        submitKey: { type: 'string', enum: ['Enter', 'Tab'], description: '输入后按的键（可选）' },
      },
      required: ['pageId', 'text'],
    },
  },
  {
    name: 'browser_fill',
    description: '清空并填写输入框（先 clear 再 type）。适合表单填写场景。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '目标页面 ID' },
        uid: { type: 'string', description: '输入框元素 uid' },
        value: { type: 'string', description: '要填入的值' },
      },
      required: ['pageId', 'uid', 'value'],
    },
  },
  {
    name: 'browser_screenshot',
    description: '截取页面当前状态的截图并保存为 PNG 文件。必须提供 filePath 指定保存路径（绝对路径，.png 后缀）。截图由 Electron 直接写入文件，保证二进制完整，禁止用其他工具重新写入截图内容。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '目标页面 ID' },
        filePath: { type: 'string', description: '截图保存路径（绝对路径，.png 后缀），必填' },
      },
      required: ['pageId', 'filePath'],
    },
  },
  {
    name: 'browser_evaluate',
    description: '在页面中执行 JavaScript 代码并返回结果。用于提取数据、操作 DOM 等高级场景。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '目标页面 ID' },
        expression: { type: 'string', description: '要执行的 JavaScript 表达式' },
      },
      required: ['pageId', 'expression'],
    },
  },
  {
    name: 'browser_close_page',
    description: '关闭指定标签页。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '要关闭的页面 ID' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'browser_wait_for',
    description: '等待页面上出现指定文字或元素稳定，适合在操作后等待页面响应。',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '目标页面 ID' },
        text: { type: 'array', items: { type: 'string' }, description: '等待页面出现的文字列表（满足其一即可）' },
        timeoutMs: { type: 'number', description: '超时时间（毫秒），默认 8000' },
      },
      required: ['pageId'],
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'browser_list_pages': {
      const data = await callBridge('GET', '/v1/pages');
      return { content: [{ type: 'text', text: JSON.stringify(data.tabs || data, null, 2) }] };
    }
    case 'browser_open_page': {
      const data = await callBridge('POST', '/v1/pages/new', { url: args.url, background: HEADLESS || (args.background ?? false) });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'browser_navigate': {
      const body = { pageId: args.pageId, type: args.type || 'url', url: args.url, background: HEADLESS };
      const data = await callBridge('POST', '/v1/pages/navigate', body);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'browser_snapshot': {
      const data = await callBridge('POST', '/v1/pages/snapshot', { pageId: args.pageId, background: HEADLESS });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    case 'browser_click': {
      const data = await callBridge('POST', '/v1/pages/click', { pageId: args.pageId, uid: args.uid, background: HEADLESS });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'browser_type': {
      const data = await callBridge('POST', '/v1/pages/type', { pageId: args.pageId, text: args.text, submitKey: args.submitKey, background: HEADLESS });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'browser_fill': {
      const data = await callBridge('POST', '/v1/pages/fill', { pageId: args.pageId, uid: args.uid, value: args.value, background: HEADLESS });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'browser_screenshot': {
      const data = await callBridge('POST', '/v1/pages/screenshot', { pageId: args.pageId, filePath: args.filePath, background: HEADLESS });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, filePath: data.filePath, pageId: data.pageId }) }] };
    }
    case 'browser_evaluate': {
      const data = await callBridge('POST', '/v1/pages/evaluate', { pageId: args.pageId, expression: args.expression, background: HEADLESS });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'browser_close_page': {
      const data = await callBridge('POST', '/v1/pages/close', { pageId: args.pageId });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    case 'browser_wait_for': {
      const data = await callBridge('POST', '/v1/pages/wait-for', { pageId: args.pageId, text: args.text, timeoutMs: args.timeoutMs, background: HEADLESS });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

async function handleRequest(request) {
  const { method, params, id } = request;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'browser', version: '1.0.0' },
      },
    };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      if (!TOOLS.some(t => t.name === name)) throw new Error(`未知工具：${name}`);
      const result = await callTool(name, args || {});
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0', id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}

async function main() {
  log('[browser-mcp] 启动中...');
  const config = getBridgeConfig();
  if (config) {
    log(`[browser-mcp] Bridge URL: ${config.url}`);
  } else {
    log('[browser-mcp] 警告：bridge 配置未找到，将在工具调用时重试');
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const request = JSON.parse(trimmed);
      // Notifications (no id) must not receive a response per JSON-RPC spec.
      // Sending a spurious error response confuses the SDK's request/response matcher.
      if (request.id === undefined) return;
      const response = await handleRequest(request);
      console.log(JSON.stringify(response));
    } catch (error) {
      log(`[browser-mcp] 解析错误：${error}`);
    }
  });

  rl.on('close', () => {
    log('[browser-mcp] stdin 关闭，退出');
    process.exit(0);
  });
}

main().catch(err => {
  log(`[browser-mcp] 启动失败：${err}`);
  process.exit(1);
});
