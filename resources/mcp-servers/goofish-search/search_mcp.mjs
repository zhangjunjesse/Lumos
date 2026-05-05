#!/usr/bin/env node
/**
 * Goofish search MCP — exposes a single tool, `goofish_search_chats`, that
 * lets the AI find buyers / messages by keyword via the local SQLite archive.
 *
 * Why a separate server: the upstream `goofish-mcp` (from goofish-cli) only
 * surfaces live mtop tools — it doesn't know about our cached archive.
 * Rather than fork upstream, we run a tiny stdio MCP alongside it that
 * proxies search queries to Lumos's HTTP API.
 *
 * Lumos URL is read from `LUMOS_INTERNAL_URL` (set by the MCP env enricher,
 * defaults to http://localhost:3000).
 */

import { createInterface } from 'node:readline';
import process from 'node:process';

const SERVER_INFO = { name: 'goofish-search', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';
const LUMOS_URL = process.env.LUMOS_INTERNAL_URL || 'http://localhost:3000';

const ACCOUNT_PROP = {
  account: {
    type: 'string',
    description:
      '账号 unb，用于在多账号场景下指定操作哪个号。传 "all" 或省略 = 跨所有账号。' +
      '可先调 goofish_list_accounts 拿到所有账号的 unb / 昵称。',
    default: 'all',
  },
};

const TOOLS = [
  {
    name: 'goofish_list_accounts',
    description:
      '列出已登录的所有闲鱼账号 { accountUnb, unb, nick, valid }。' +
      '面对"账号 1"这种用户输入时先调本工具把名称解析成 unb。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'goofish_get_inbox',
    description:
      '【概览/汇报闲鱼情况的最佳工具，AI 优先用这个】一次性返回最近会话 + 每个会话的最近 N 条消息。' +
      '会自动按新鲜度触发 WS 同步（默认数据老于 30 秒就重新同步，约 15-30 秒）。' +
      '返回的内容已经包含足够上下文，AI 可以直接总结，不必再一个个调 message history。' +
      '过滤了系统通知（系统消息/卖家小助手/活动），只看真实买家会话。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionLimit: { type: 'integer', description: '最多返回多少个会话', default: 30 },
        messagesPerChat: { type: 'integer', description: '每个会话嵌入多少条最近消息', default: 10 },
        unreadOnly: { type: 'boolean', description: '只返回有未读数的会话', default: false },
        forceSync: { type: 'boolean', description: '强制立即同步（默认按新鲜度判断）', default: false },
        ...ACCOUNT_PROP,
      },
    },
  },
  {
    name: 'goofish_list_sessions',
    description:
      '只列会话列表（不带消息内容）—— 比 goofish_get_inbox 轻量，但需要 AI 再单独查消息。' +
      '一般情况建议直接用 goofish_get_inbox，避免多轮工具调用。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 100 },
        unreadOnly: { type: 'boolean', default: false },
        forceSync: { type: 'boolean', default: false },
        ...ACCOUNT_PROP,
      },
    },
  },
  {
    name: 'goofish_search_items',
    description:
      '【在闲鱼上搜索商品】用 Lumos 内置浏览器后台跑（不弹窗），不再走上游 search_items 那个会弹 Chrome 的工具。' +
      '需要至少一个登录态账号；不传 account 时自动选第一个可用账号的 cookies 注入。' +
      '返回的每条 item 含：itemId / 标题 / 价格 / 主图 / 卖家昵称 / 地点。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词（中文/英文都行）' },
        limit: { type: 'integer', description: '最多返回的商品数', default: 30 },
        ...ACCOUNT_PROP,
      },
      required: ['keyword'],
    },
  },
  {
    name: 'goofish_get_chat_messages',
    description:
      '【拉取指定会话完整消息内容】根据 cid 取最近 N 条消息，含时间戳、发送者、内容。' +
      '会自动从 DB 找出该 cid 属于哪个账号，并用对应 cookies 调取，**不依赖账号默认上下文**。' +
      '比上游 message_history 更可靠（上游会用错账号）。',
    inputSchema: {
      type: 'object',
      properties: {
        cid: { type: 'string', description: '会话 ID（如 60940073936）' },
        limit: { type: 'integer', description: '最多返回的消息条数', default: 30 },
      },
      required: ['cid'],
    },
  },
  {
    name: 'goofish_search_chats',
    description:
      '【查"提到 X 的对话/买家"的首选工具】按关键词搜索本地存档里的消息。' +
      '返回命中会话（含买家昵称、商品标题）+ 具体消息片段。毫秒级。' +
      '如需先确保数据最新，调用前先调一次 goofish_list_sessions（会自动 sync）。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词（支持中文）' },
        limit: { type: 'integer', description: '最多返回的命中条数', default: 50 },
        ...ACCOUNT_PROP,
      },
      required: ['keyword'],
    },
  },
  {
    name: 'goofish_sync',
    description:
      '强制立即触发闲鱼数据同步（WS + baseline + 消息历史，写入本地存档）。15-30 秒。' +
      '通常不用直接调 —— goofish_list_sessions 会按需自动触发。',
    inputSchema: {
      type: 'object',
      properties: {
        watchSecs: { type: 'number', default: 8 },
        messageLimit: { type: 'integer', default: 30 },
        ...ACCOUNT_PROP,
      },
    },
  },
];

async function ensureFreshSync(account, force) {
  const triggerSync = () => fetch(`${LUMOS_URL}/api/goofish/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account }),
  });
  if (force) { await triggerSync(); return; }
  try {
    const sres = await fetch(`${LUMOS_URL}/api/goofish/sync`);
    const sd = await sres.json();
    if (!sd?.lastSyncMs || Date.now() - Number(sd.lastSyncMs) > 30_000) {
      await triggerSync();
    }
  } catch { /* sync failure non-fatal */ }
}

async function callTool(name, args) {
  const account = args.account || 'all';
  if (name === 'goofish_list_accounts') {
    const res = await fetch(`${LUMOS_URL}/api/goofish/auth/status`);
    const data = await res.json();
    return {
      ok: true,
      accounts: (data?.accounts || []).map((a) => ({
        accountUnb: a.accountUnb,
        unb: a.unb,
        nick: a.nick,
        tracknick: a.tracknick,
        valid: a.valid,
      })),
    };
  }
  if (name === 'goofish_search_chats') {
    const url = `${LUMOS_URL}/api/goofish/search?q=${encodeURIComponent(args.keyword || '')}&limit=${Number(args.limit) || 50}&account=${encodeURIComponent(account)}`;
    const res = await fetch(url);
    return await res.json();
  }
  if (name === 'goofish_sync') {
    const res = await fetch(`${LUMOS_URL}/api/goofish/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account,
        watchSecs: typeof args.watchSecs === 'number' ? args.watchSecs : 8,
        messageLimit: typeof args.messageLimit === 'number' ? args.messageLimit : 30,
      }),
    });
    return await res.json();
  }
  if (name === 'goofish_search_items') {
    const keyword = String(args.keyword || '');
    if (!keyword) return { ok: false, error: 'keyword required' };
    const params = new URLSearchParams({
      q: keyword,
      account,
      limit: String(args.limit ?? 30),
    });
    const res = await fetch(`${LUMOS_URL}/api/goofish/search-items?${params}`);
    return await res.json();
  }
  if (name === 'goofish_get_chat_messages') {
    const cid = String(args.cid || '');
    if (!cid) return { ok: false, error: 'cid required' };
    const limit = Number(args.limit) || 30;
    const url = `${LUMOS_URL}/api/goofish/messages/${encodeURIComponent(cid)}?limit=${limit}`;
    const res = await fetch(url);
    return await res.json();
  }
  if (name === 'goofish_get_inbox') {
    // Same freshness check as list_sessions — sync if stale or forced.
    await ensureFreshSync(account, args.forceSync);
    const params = new URLSearchParams({
      account,
      sessionLimit: String(args.sessionLimit ?? 30),
      messagesPerChat: String(args.messagesPerChat ?? 10),
      ...(args.unreadOnly ? { unreadOnly: '1' } : {}),
    });
    const res = await fetch(`${LUMOS_URL}/api/goofish/inbox?${params}`);
    return await res.json();
  }
  if (name === 'goofish_list_sessions') {
    await ensureFreshSync(account, args.forceSync);
    const res = await fetch(`${LUMOS_URL}/api/goofish/sessions?account=${encodeURIComponent(account)}`);
    const data = await res.json();
    if (data?.sessions) {
      let rows = data.sessions;
      if (args.unreadOnly) rows = rows.filter((s) => Number(s.unread) > 0);
      data.sessions = rows.slice(0, Number(args.limit) || 100).map((s) => ({
        cid: s.cid,
        account_unb: s.account_unb,
        peer_nick: s.peer_nick,
        peer_user_id: s.peer_user_id,
        item_title: s.item_title,
        item_id: s.item_id,
        unread: s.unread,
        last_msg: s.last_msg,
        ts: s.ts,
      }));
    }
    return data;
  }
  throw new Error(`unknown tool: ${name}`);
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(req) {
  const { id, method, params } = req;
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO } };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    try {
      const out = await callTool(params?.name, params?.arguments || {});
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
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
