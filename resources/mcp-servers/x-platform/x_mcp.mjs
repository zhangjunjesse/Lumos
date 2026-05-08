#!/usr/bin/env node
/**
 * X (Twitter) MCP server.
 *
 * 暴露 4 个工具让 AI 在 X 上搜索、发推、读时间线。底层都通过 Lumos HTTP API
 * 调用 (/api/x/*),所以 cookie 管理 / auth-expired 拦截 / GraphQL query_id
 * 维护都集中在 Lumos 主进程,MCP 进程是薄壳。
 *
 * Lumos URL 由 LUMOS_INTERNAL_URL 注入(MCP env enricher),默认 localhost:3000。
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SERVER_INFO = { name: 'x-platform', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';
const LUMOS_URL = process.env.LUMOS_INTERNAL_URL || 'http://localhost:3000';

const TOOLS = [
  {
    name: 'x_search',
    description:
      '在 X (Twitter) 上搜索推文。支持 X 高级搜索语法,如 from:elonmusk、#hashtag、"phrase"、since:2026-01-01。' +
      '默认按相关性返回 Top 推文(不是按时间)。需要用户已在 Lumos「服务 → X」登录。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '搜索关键词或 X 高级搜索表达式' },
        count: { type: 'integer', description: '返回数量,1-50', default: 20 },
      },
      required: ['q'],
    },
  },
  {
    name: 'x_post_tweet',
    description:
      '发布一条推文到当前登录的 X 账号。280 字上限,最多 4 张图片(jpeg/png/gif/webp,每张 ≤5MB)。' +
      '注意: 用户没主动要求发推时不要随便调用此工具(写操作)。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '推文内容,最多 280 字' },
        mediaPaths: {
          type: 'array',
          items: { type: 'string' },
          description: '本地图片绝对路径数组,最多 4 张,留空就纯文字推。',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'x_read_home_timeline',
    description: '读取当前登录用户的 X 主页时间线最新推文。',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', description: '返回数量,1-50', default: 20 },
      },
    },
  },
  {
    name: 'x_read_user_tweets',
    description: '读取某个 X 用户的最新推文。userId 是数字 ID,不是 @ 用户名。',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'X 用户的数字 ID' },
        count: { type: 'integer', description: '返回数量,1-50', default: 20 },
      },
      required: ['userId'],
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

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
};

async function uploadLocalImage(filePath) {
  if (!existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error(`不是文件: ${filePath}`);
  if (stat.size > 5 * 1024 * 1024) {
    throw new Error(`文件超过 5MB (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`不支持的图片扩展名 ${ext}: ${filePath}`);
  const data = readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([data], { type: mime }), path.basename(filePath));
  const result = await fetchJson(`${LUMOS_URL}/api/x/media`, { method: 'POST', body: form });
  if (!result.mediaId) throw new Error(`上传 ${filePath} 失败: 响应缺 mediaId`);
  return String(result.mediaId);
}

async function callTool(name, args) {
  if (name === 'x_search') {
    const params = new URLSearchParams({
      q: String(args.q || ''),
      count: String(args.count ?? 20),
    });
    return await fetchJson(`${LUMOS_URL}/api/x/search?${params}`);
  }
  if (name === 'x_post_tweet') {
    const mediaIds = [];
    const paths = Array.isArray(args.mediaPaths) ? args.mediaPaths : [];
    if (paths.length > 4) throw new Error(`最多 4 张图,提供了 ${paths.length} 张`);
    for (const p of paths) {
      if (typeof p !== 'string' || !p) continue;
      mediaIds.push(await uploadLocalImage(p));
    }
    return await fetchJson(`${LUMOS_URL}/api/x/tweets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(args.text || ''), mediaIds }),
    });
  }
  if (name === 'x_read_home_timeline') {
    const params = new URLSearchParams({
      type: 'home',
      count: String(args.count ?? 20),
    });
    return await fetchJson(`${LUMOS_URL}/api/x/timeline?${params}`);
  }
  if (name === 'x_read_user_tweets') {
    const userId = String(args.userId || '');
    if (!/^\d+$/.test(userId)) {
      throw new Error('userId 必须是数字 ID,不是 @ 用户名');
    }
    const params = new URLSearchParams({
      type: 'user',
      userId,
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
