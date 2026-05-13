#!/usr/bin/env node
/**
 * Douyin collector MCP — exposes tools for the built-in 抖音采集器 app:
 * collect videos by creator / keyword / video link, fetch subtitles,
 * summarize, and publish to the default knowledge collection.
 *
 * Why a dedicated server: the app's HTTP API is the single source of truth
 * for douyin auth state, rate-limit handling, and structured failure
 * reasons. The AI agent should hit those endpoints (not raw douyin) so
 * the user-visible failure stack stays consistent with the UI.
 *
 * Lumos URL is read from `LUMOS_INTERNAL_URL` (defaults to localhost:3000).
 */

import { createInterface } from 'node:readline';
import process from 'node:process';

const SERVER_INFO = { name: 'douyin-collector', version: '0.0.1' };
const PROTOCOL_VERSION = '2024-11-05';
const LUMOS_URL = process.env.LUMOS_INTERNAL_URL || 'http://localhost:3000';
const BASE = `${LUMOS_URL}/api/apps/builtin/douyin-collector`;

const TOOLS = [
  {
    name: 'douyin_search_creator',
    description:
      '【只读预览：按博主搜索抖音视频】传主页链接 / sec_uid / v.douyin.com 短链。返回最近视频元数据，不写入采集库。需要入库请用 douyin_collect_creator 或 douyin_collect_creators。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '主页链接 / sec_uid / 短链 token' },
        limit: { type: 'integer', description: '最多返回视频数', default: 30 },
      },
      required: ['input'],
    },
  },
  {
    name: 'douyin_search_keyword',
    description:
      '【按关键词采集并默认处理】会创建/复用关键词订阅，执行一次采集任务，并默认抓字幕、生成摘要、入库到默认知识库。若只想采集元数据，把 auto_process 设为 false。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        time_window: {
          type: 'string',
          enum: ['day', 'week', 'month', 'all'],
          default: 'week',
        },
        limit: { type: 'integer', default: 50 },
        dedupe_window_days: { type: 'integer', default: 30 },
        auto_process: { type: 'boolean', default: true },
        publish_to_knowledge: { type: 'boolean', default: true },
      },
      required: ['query'],
    },
  },
  {
    name: 'douyin_collect_video',
    description:
      '【采集单条抖音视频并默认处理】传视频链接、短链或 aweme_id。默认会采集视频、抓字幕、生成摘要并入库到默认知识库；如果只想采集元数据，把 auto_process 设为 false。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '抖音视频链接 / 短链 / aweme_id' },
        auto_process: { type: 'boolean', default: true },
        publish_to_knowledge: { type: 'boolean', default: true },
      },
      required: ['input'],
    },
  },
  {
    name: 'douyin_collect_creator',
    description:
      '【按单个博主采集】传主页链接 / sec_uid / 可解析短链。会创建或复用博主订阅并立即执行一次采集；批量博主请用 douyin_collect_creators。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '主页链接 / sec_uid / 短链 token' },
        nickname: { type: 'string', description: '可选：给订阅记录用的显示名' },
        cadence: { type: 'string', enum: ['manual', 'hourly', 'daily', 'weekly'], default: 'manual' },
        limit: { type: 'integer', default: 30 },
        auto_process: { type: 'boolean', default: false },
        publish_to_knowledge: { type: 'boolean', default: true },
      },
      required: ['input'],
    },
  },
  {
    name: 'douyin_collect_creators',
    description:
      '【兼容旧名：批量采集博主/关键词/链接】用于 AI 一次接收多个目标。新调用优先使用 douyin_batch_collect；需要自动抓字幕、总结、入库时显式设置 auto_process=true。',
    inputSchema: {
      type: 'object',
      properties: {
        creators: { type: 'array', items: { type: 'string' }, description: '博主主页链接 / sec_uid 列表' },
        keywords: { type: 'array', items: { type: 'string' }, description: '关键词列表' },
        links: { type: 'array', items: { type: 'string' }, description: '视频链接 / aweme_id 列表' },
        limit_per_source: { type: 'integer', default: 30 },
        auto_process: { type: 'boolean', default: false },
        publish_to_knowledge: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'douyin_batch_collect',
    description:
      '【批量采集博主/关键词/链接】推荐批量入口。默认只采集元数据，避免大批量 ASR 产生费用；需要自动抓字幕、总结、入库时显式设置 auto_process=true。',
    inputSchema: {
      type: 'object',
      properties: {
        creators: { type: 'array', items: { type: 'string' }, description: '博主主页链接 / sec_uid 列表' },
        keywords: { type: 'array', items: { type: 'string' }, description: '关键词列表' },
        links: { type: 'array', items: { type: 'string' }, description: '视频链接 / aweme_id 列表' },
        limit_per_source: { type: 'integer', default: 30 },
        auto_process: { type: 'boolean', default: false },
        publish_to_knowledge: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'douyin_get_video_detail',
    description:
      '【拉取单条视频元数据】传 aweme_id 或抖音视频链接（www.douyin.com/video/... 或 v.douyin.com 短链）。返回标题、博主、时长、封面、原生字幕 URL（如果有）。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'aweme_id 或视频链接' },
      },
      required: ['input'],
    },
  },
  {
    name: 'douyin_process_video',
    description:
      '【处理已采集视频】传 video_id、aweme_id 或视频链接。默认抓字幕、生成摘要并入库到默认知识库；可关闭 transcribe/summarize/publish_to_knowledge。',
    inputSchema: {
      type: 'object',
      properties: {
        video_id: { type: 'string', description: '抖音采集器 videos 记录 id' },
        aweme_id: { type: 'string', description: '抖音 aweme_id' },
        input: { type: 'string', description: '视频链接 / 短链 / aweme_id' },
        transcribe: { type: 'boolean', default: true },
        summarize: { type: 'boolean', default: true },
        publish_to_knowledge: { type: 'boolean', default: true },
        force_transcribe: { type: 'boolean', default: false },
        prefer: {
          type: 'string',
          enum: ['native-only', 'allow-asr', 'force-local-asr'],
          default: 'allow-asr',
        },
      },
    },
  },
  {
    name: 'douyin_summarize_video',
    description:
      '【总结单条抖音视频】传 video_id、aweme_id 或视频链接。会先确保有字幕/转写，再生成内容摘要；默认不入库，若要同时写入默认知识库请设置 publish_to_knowledge=true。',
    inputSchema: {
      type: 'object',
      properties: {
        video_id: { type: 'string', description: '抖音采集器 videos 记录 id' },
        aweme_id: { type: 'string', description: '抖音 aweme_id' },
        input: { type: 'string', description: '视频链接 / 短链 / aweme_id' },
        publish_to_knowledge: { type: 'boolean', default: false },
        force_transcribe: { type: 'boolean', default: false },
        prefer: {
          type: 'string',
          enum: ['native-only', 'allow-asr', 'force-local-asr'],
          default: 'allow-asr',
        },
      },
    },
  },
  {
    name: 'douyin_get_subtitle',
    description:
      '【抓字幕】优先级：抖音原生字幕 → 抖音 ASR → Lumos speech-to-text MCP 兜底。30 分钟长视频会自动分段（默认每段 10 分钟，最多 4 路并发）。失败返回结构化原因，不冒充成功。',
    inputSchema: {
      type: 'object',
      properties: {
        aweme_id: { type: 'string', description: '视频 aweme_id' },
        prefer: {
          type: 'string',
          enum: ['native-only', 'allow-asr', 'force-local-asr'],
          default: 'allow-asr',
        },
      },
      required: ['aweme_id'],
    },
  },
  {
    name: 'douyin_enqueue_collect',
    description:
      '【兼容旧工具：创建采集任务】kind=creator/keyword/link。creator/keyword 的 target_ref 必须是应用内订阅记录 id；新调用优先使用 douyin_collect_video / douyin_collect_creator / douyin_search_keyword。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['creator', 'keyword', 'link'] },
        target_ref: { type: 'string' },
      },
      required: ['kind', 'target_ref'],
    },
  },
];

async function callTool(name, args) {
  if (name === 'douyin_search_creator') {
    return await postJson(`${BASE}/mcp/search-creator`, {
      input: String(args.input ?? ''),
      limit: Number(args.limit ?? 30),
    });
  }
  if (name === 'douyin_search_keyword') {
    return await postJson(`${BASE}/mcp/search-keyword`, {
      query: String(args.query ?? ''),
      time_window: String(args.time_window ?? 'week'),
      limit: Number(args.limit ?? 50),
      dedupe_window_days: Number(args.dedupe_window_days ?? 30),
      auto_process: args.auto_process !== false,
      publish_to_knowledge: args.publish_to_knowledge !== false,
    });
  }
  if (name === 'douyin_collect_video') {
    return await postJson(`${BASE}/mcp/collect`, {
      kind: 'link',
      input: String(args.input ?? ''),
      auto_process: args.auto_process !== false,
      publish_to_knowledge: args.publish_to_knowledge !== false,
    });
  }
  if (name === 'douyin_collect_creator') {
    return await postJson(`${BASE}/mcp/collect`, {
      kind: 'creator',
      input: String(args.input ?? ''),
      nickname: args.nickname == null ? undefined : String(args.nickname),
      cadence: String(args.cadence ?? 'manual'),
      limit: Number(args.limit ?? 30),
      auto_process: Boolean(args.auto_process ?? false),
      publish_to_knowledge: args.publish_to_knowledge !== false,
    });
  }
  if (name === 'douyin_collect_creators' || name === 'douyin_batch_collect') {
    return await postJson(`${BASE}/mcp/batch-collect`, {
      creators: Array.isArray(args.creators) ? args.creators.map(String) : [],
      keywords: Array.isArray(args.keywords) ? args.keywords.map(String) : [],
      links: Array.isArray(args.links) ? args.links.map(String) : [],
      limit_per_source: Number(args.limit_per_source ?? 30),
      auto_process: Boolean(args.auto_process ?? false),
      publish_to_knowledge: args.publish_to_knowledge !== false,
    });
  }
  if (name === 'douyin_summarize_video') {
    return await postJson(`${BASE}/mcp/process-video`, {
      video_id: args.video_id == null ? undefined : String(args.video_id),
      aweme_id: args.aweme_id == null ? undefined : String(args.aweme_id),
      input: args.input == null ? undefined : String(args.input),
      transcribe: true,
      summarize: true,
      publish_to_knowledge: args.publish_to_knowledge === true,
      force_transcribe: Boolean(args.force_transcribe ?? false),
      prefer: String(args.prefer ?? 'allow-asr'),
    });
  }
  if (name === 'douyin_get_video_detail') {
    return await postJson(`${BASE}/mcp/video-detail`, {
      input: String(args.input ?? ''),
    });
  }
  if (name === 'douyin_process_video') {
    return await postJson(`${BASE}/mcp/process-video`, {
      video_id: args.video_id == null ? undefined : String(args.video_id),
      aweme_id: args.aweme_id == null ? undefined : String(args.aweme_id),
      input: args.input == null ? undefined : String(args.input),
      transcribe: args.transcribe !== false,
      summarize: args.summarize !== false,
      publish_to_knowledge: args.publish_to_knowledge !== false,
      force_transcribe: Boolean(args.force_transcribe ?? false),
      prefer: String(args.prefer ?? 'allow-asr'),
    });
  }
  if (name === 'douyin_get_subtitle') {
    return await postJson(`${BASE}/mcp/subtitle`, {
      aweme_id: String(args.aweme_id ?? ''),
      prefer: String(args.prefer ?? 'allow-asr'),
    });
  }
  if (name === 'douyin_enqueue_collect') {
    return await postJson(`${BASE}/jobs`, {
      kind: String(args.kind ?? ''),
      target_ref: String(args.target_ref ?? ''),
    });
  }
  throw new Error(`unknown tool: ${name}`);
}

async function postJson(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data?.error ?? `HTTP ${res.status}`,
        ...data,
      };
    }
    return { ok: true, ...data };
  } catch (err) {
    return {
      ok: false,
      error: `Lumos API 不可达：${err?.message ?? err}`,
    };
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(req) {
  const { id, method, params } = req;
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
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
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `error: ${err.message}` }],
          isError: true,
        },
      };
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const resp = await handle(req);
  if (resp) send(resp);
});
rl.on('close', () => process.exit(0));
