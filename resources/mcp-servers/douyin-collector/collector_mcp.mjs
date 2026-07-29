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
      '【按关键词采集并默认处理（同步，无中间反馈）】会创建/复用关键词订阅，执行一次采集，并默认抓字幕、生成摘要、入库。此调用同步阻塞、通常数分钟且期间对话无进度。当用户在意等待体验/想看进度时，不要用本工具——改用 douyin_start_collect(kind=keyword, input=关键词) 后轮询 douyin_job_status 逐步播报。仅在明确不需要进度、要一次拿到最终结果时用本工具；只想采集元数据则 auto_process=false。',
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
    name: 'douyin_collect',
    description:
      '【采集单条抖音作品并默认处理】视频和图文都用这一个工具，不用先判断类型 —— 传链接、短链、完整分享文案或 aweme_id 都行，工具自己解析短链并识别内容类型。视频走字幕/ASR，图文读正文和图片上的文字，之后都会生成摘要并入库到默认知识库；只想要元数据就把 auto_process 设为 false。不支持的类型（直播等）会返回明确的 type/reason，不要改用别的工具重试。严禁在工具失败、文本为空或只拿到标题/封面/作者时，根据标题模拟字幕、摘要或内容观点；必须如实返回失败阶段和原因。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '抖音视频/图文链接、短链、完整分享文案或 aweme_id' },
        auto_process: { type: 'boolean', default: true },
        publish_to_knowledge: { type: 'boolean', default: true },
      },
      required: ['input'],
    },
  },
  {
    name: 'douyin_collect_creator',
    description:
      '【按单个博主采集】传主页链接 / sec_uid / 可解析短链。会创建或复用博主订阅并立即执行一次采集，默认抓字幕→总结→入库（auto_process 默认 true）；只想要元数据传 auto_process=false。批量博主请用 douyin_collect_creators。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '主页链接 / sec_uid / 短链 token' },
        nickname: { type: 'string', description: '可选：给订阅记录用的显示名' },
        cadence: { type: 'string', enum: ['manual', 'hourly', 'daily', 'weekly'], default: 'manual' },
        limit: { type: 'integer', default: 30 },
        auto_process: { type: 'boolean', default: true },
        publish_to_knowledge: { type: 'boolean', default: true },
      },
      required: ['input'],
    },
  },
  {
    name: 'douyin_collect_creators',
    description:
      '【兼容旧名：批量采集博主/关键词/链接】用于 AI 一次接收多个目标。新调用优先使用 douyin_batch_collect。默认抓字幕→总结→入库（auto_process 默认 true）；只想要元数据传 auto_process=false（批量量大时注意 ASR 费用）。',
    inputSchema: {
      type: 'object',
      properties: {
        creators: { type: 'array', items: { type: 'string' }, description: '博主主页链接 / sec_uid 列表' },
        keywords: { type: 'array', items: { type: 'string' }, description: '关键词列表' },
        links: { type: 'array', items: { type: 'string' }, description: '视频链接 / aweme_id 列表' },
        limit_per_source: { type: 'integer', default: 30 },
        auto_process: { type: 'boolean', default: true },
        publish_to_knowledge: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'douyin_batch_collect',
    description:
      '【批量采集博主/关键词/链接】推荐批量入口。默认抓字幕→总结→入库（auto_process 默认 true）；只想要元数据传 auto_process=false。批量量大时注意：开启处理会对每条走 ASR，可能产生较多费用。',
    inputSchema: {
      type: 'object',
      properties: {
        creators: { type: 'array', items: { type: 'string' }, description: '博主主页链接 / sec_uid 列表' },
        keywords: { type: 'array', items: { type: 'string' }, description: '关键词列表' },
        links: { type: 'array', items: { type: 'string' }, description: '视频链接 / aweme_id 列表' },
        limit_per_source: { type: 'integer', default: 30 },
        auto_process: { type: 'boolean', default: true },
        publish_to_knowledge: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'douyin_get_detail',
    description:
      '【拉取单条作品元数据】传 aweme_id 或抖音链接（/video/、/note/ 或 v.douyin.com 短链）。返回内容类型、标题、博主、封面，视频另有时长和原生字幕 URL、图文另有图片列表。只想确认这条链接是什么类型时也用它。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'aweme_id 或抖音作品链接（视频 / 图文均可）' },
      },
      required: ['input'],
    },
  },
  {
    name: 'douyin_process',
    description:
      '【处理已采集作品】传 video_id、aweme_id 或作品链接，视频图文通用。默认取文本（视频抓字幕、图文读图）、生成摘要并入库到默认知识库；可关闭 transcribe/summarize/publish_to_knowledge。只有工具结果明确返回文本/总结/入库成功时才能声称成功；不得用标题、描述或常识补写不存在的内容。',
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
    name: 'douyin_summarize',
    description:
      '【总结单条抖音作品】传 video_id、aweme_id 或作品链接，视频图文通用。会先确保有文本（视频的字幕/转写、图文的正文与图上文字），再生成内容摘要；默认不入库，若要同时写入默认知识库请设置 publish_to_knowledge=true。若文本不可用或为空，必须报告失败，不得根据标题/作者/封面猜测内容。',
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
    name: 'douyin_get_transcript',
    description:
      '【取作品文本】视频走字幕：抖音原生字幕 → 抖音 ASR → Lumos speech-to-text MCP 兜底，30 分钟长视频自动分段（默认每段 10 分钟，最多 4 路并发）；图文走正文 + 图片文字（本地 OCR，识别质量不达标时自动改用视觉模型）。失败返回结构化原因，不冒充成功；不得根据标题、描述、评论或作者补写伪文本。',
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
      '【后台采集 + 可轮询进度】创建采集任务并立即返回 job（不阻塞）。kind=creator/keyword/link，target_ref 对 creator/keyword 必须是应用内订阅记录 id。想给用户实时进度时：用此工具拿到 job.id 后，每隔几秒调用 douyin_job_status 播报「正在采集/处理 N/总」，直到 status 为 success/failed。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['creator', 'keyword', 'link'] },
        target_ref: { type: 'string' },
      },
      required: ['kind', 'target_ref'],
    },
  },
  {
    name: 'douyin_start_collect',
    description:
      '【进度可见的采集入口（推荐用于关键词/博主长任务）】传原始关键词 / 博主主页链接 / 视频链接，服务端自动建订阅记录并后台启动采集，立即返回 job（不阻塞）。默认采完元数据后继续在后台抓字幕→生成摘要→基于字幕入库（auto_process 默认 true，对齐 douyin_search_keyword）；只想要元数据则 auto_process=false。拿到 job.id 后每隔几秒调用 douyin_job_status 把 progress_text 播报给用户（如「正在补全 3/20、已入库 2」「正在抓字幕 5/20」），直到 status 为 success/failed。想让用户看到中间进度时优先用本工具而非同步的 douyin_search_keyword。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['keyword', 'creator', 'link'] },
        input: { type: 'string', description: '原始关键词 / 主页链接 / 视频链接 / 短链 / aweme_id' },
        nickname: { type: 'string', description: 'creator 可选显示名' },
        cadence: { type: 'string', enum: ['manual', 'hourly', 'daily', 'weekly'], default: 'manual' },
        time_window: { type: 'string', enum: ['day', 'week', 'month', 'all'], default: 'week' },
        dedupe_window_days: { type: 'integer', default: 30 },
        auto_process: {
          type: 'boolean',
          default: true,
          description: '采完元数据后是否继续抓字幕/摘要/入库；默认 true，false 仅采元数据',
        },
        publish_to_knowledge: {
          type: 'boolean',
          default: true,
          description: '处理完成后是否发布到默认资料库；默认 true。false 只保留在采集器资料库。',
        },
      },
      required: ['kind', 'input'],
    },
  },
  {
    name: 'douyin_job_status',
    description:
      '【查询采集任务进度】传 job_id 返回该任务的状态与实时进度（阶段、已处理 N/总、已入库、被风控、一句话进度文本 progress_text）。不传 job_id 则返回最近任务列表。配合 douyin_enqueue_collect 使用：长任务期间每隔数秒轮询一次并把 progress_text 播报给用户，让等待过程可见。',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: '采集任务 id；省略则列出最近任务' },
      },
    },
  },
  {
    name: 'douyin_list_content',
    description:
      '【列出已采集的视频清单】返回采集器里已入库的视频精简列表（标题、作者、视频链接、字幕状态 transcript_status、入库状态 library_status、时长、标签、摘要、更新时间），用于向用户核对"到底采到了哪些视频"。支持 query 模糊检索（标题/作者/摘要/标签）、library_status / transcript_status 精确过滤、limit/offset 分页。返回含 total（过滤后总数）便于判断是否还有更多。这是只读核对工具，不触发任何采集。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '模糊匹配 标题/作者/摘要/标签（可选）' },
        library_status: {
          type: 'string',
          enum: ['unprocessed', 'draft', 'published', 'discarded'],
          description: '按入库状态过滤（可选）',
        },
        transcript_status: {
          type: 'string',
          description: '按字幕状态过滤，如 success / failed / running（可选）',
        },
        limit: { type: 'integer', default: 50, description: '每页条数，默认 50，上限 500' },
        offset: { type: 'integer', default: 0, description: '分页偏移，默认 0' },
      },
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
  if (name === 'douyin_collect') {
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
      auto_process: args.auto_process !== false,
      publish_to_knowledge: args.publish_to_knowledge !== false,
    });
  }
  if (name === 'douyin_collect_creators' || name === 'douyin_batch_collect') {
    return await postJson(`${BASE}/mcp/batch-collect`, {
      creators: Array.isArray(args.creators) ? args.creators.map(String) : [],
      keywords: Array.isArray(args.keywords) ? args.keywords.map(String) : [],
      links: Array.isArray(args.links) ? args.links.map(String) : [],
      limit_per_source: Number(args.limit_per_source ?? 30),
      auto_process: args.auto_process !== false,
      publish_to_knowledge: args.publish_to_knowledge !== false,
    });
  }
  if (name === 'douyin_summarize') {
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
  if (name === 'douyin_get_detail') {
    return await postJson(`${BASE}/mcp/video-detail`, {
      input: String(args.input ?? ''),
    });
  }
  if (name === 'douyin_process') {
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
  if (name === 'douyin_get_transcript') {
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
  if (name === 'douyin_start_collect') {
    return await postJson(`${BASE}/jobs/start`, {
      kind: String(args.kind ?? ''),
      input: String(args.input ?? ''),
      nickname: args.nickname == null ? undefined : String(args.nickname),
      cadence: args.cadence == null ? undefined : String(args.cadence),
      time_window: args.time_window == null ? undefined : String(args.time_window),
      dedupe_window_days:
        args.dedupe_window_days == null ? undefined : Number(args.dedupe_window_days),
      auto_process: args.auto_process !== false,
      publish_to_knowledge: args.publish_to_knowledge !== false,
    });
  }
  if (name === 'douyin_job_status') {
    const jobId = args.job_id == null ? '' : String(args.job_id).trim();
    return jobId
      ? await getJson(`${BASE}/jobs/${encodeURIComponent(jobId)}`)
      : await getJson(`${BASE}/jobs`);
  }
  if (name === 'douyin_list_content') {
    return await postJson(`${BASE}/mcp/list-videos`, {
      query: args.query == null ? undefined : String(args.query),
      library_status: args.library_status == null ? undefined : String(args.library_status),
      transcript_status:
        args.transcript_status == null ? undefined : String(args.transcript_status),
      limit: args.limit == null ? undefined : Number(args.limit),
      offset: args.offset == null ? undefined : Number(args.offset),
    });
  }
  throw new Error(`unknown tool: ${name}`);
}

async function getJson(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
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
