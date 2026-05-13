#!/usr/bin/env node
/**
 * X (Twitter) MCP server — read-only。
 *
 * 暴露 2 个读工具(search / read_user_tweets)。底层走 Lumos /api/x/*,
 * 后者用 @the-convocation/twitter-scraper(2026-04 维护)绕过 X 反爬
 * (transaction-id / cookie 域 全在它内部处理)。
 *
 * 写操作(发推 / 媒体)v1 不支持: 社区 npm 包要么不维护要么 endpoint 老化,
 * 不可靠。要发推请用 X 官方 API v2 free tier。
 *
 * Lumos URL 由 LUMOS_INTERNAL_URL 注入(MCP env enricher),默认 localhost:3000。
 */

import { createInterface } from 'node:readline';
import process from 'node:process';

const SERVER_INFO = { name: 'x-platform', version: '0.2.0' };
const PROTOCOL_VERSION = '2024-11-05';
const LUMOS_URL = process.env.LUMOS_INTERNAL_URL || 'http://localhost:3000';

const TOOLS = [
  {
    name: 'x_search',
    description:
      '在 X (Twitter) 上搜索推文。支持 X 高级搜索语法,如 from:elonmusk、#hashtag、"phrase"、since:2026-01-01。' +
      '默认按相关性返回 Top 推文(mode=Top);要按时间倒序传 mode=Latest。需要用户已在 Lumos「服务 → X」登录。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '搜索关键词或 X 高级搜索表达式' },
        count: { type: 'integer', description: '返回数量,1-50', default: 20 },
        mode: {
          type: 'string',
          enum: ['Top', 'Latest', 'Photos', 'Videos', 'Users'],
          description: '搜索模式: Top=相关性 / Latest=时间倒序 / Photos=带图 / Videos=带视频 / Users=用户',
          default: 'Top',
        },
      },
      required: ['q'],
    },
  },
  {
    name: 'x_read_user_tweets',
    description: '读取某个 X 用户的最新推文。screen 是 @ 用户名(带不带 @ 都行)。',
    inputSchema: {
      type: 'object',
      properties: {
        screen: { type: 'string', description: 'X 用户名(@xxx),带不带 @ 都行' },
        count: { type: 'integer', description: '返回数量,1-50', default: 20 },
      },
      required: ['screen'],
    },
  },
];

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data?.code === 'X_AUTH_EXPIRED') {
    throw new Error('X 登录已过期,请到 Lumos「服务 → X」重新登录后再试');
  }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || `HTTP ${res.status}`);
  }
  return data;
}

async function callTool(name, args) {
  if (name === 'x_search') {
    const params = new URLSearchParams({
      q: String(args.q || ''),
      count: String(args.count ?? 20),
      mode: String(args.mode || 'Top'),
    });
    return await fetchJson(`${LUMOS_URL}/api/x/search?${params}`);
  }
  if (name === 'x_read_user_tweets') {
    const screen = String(args.screen || '').replace(/^@/, '');
    if (!screen) throw new Error('screen 不能为空');
    const params = new URLSearchParams({
      screen,
      count: String(args.count ?? 20),
    });
    return await fetchJson(`${LUMOS_URL}/api/x/timeline?${params}`);
  }
  throw new Error(`unknown tool: ${name}`);
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(req) {
  const { id, method, params } = req;
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      },
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    try {
      const out = await callTool(params?.name, params?.arguments || {});
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: `error: ${err.message}` }], isError: true },
      };
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const resp = await handle(req);
  if (resp) send(resp);
});
rl.on('close', () => process.exit(0));
