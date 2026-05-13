/**
 * Data shapes (collections + pages) for the Douyin Collector built-in app.
 * Kept in a separate module so `template-douyin-collector.ts` stays under
 * the project's 300-line per-file guideline.
 */

export function buildDouyinCollections(): unknown[] {
  return [
    creators(),
    keywords(),
    collectJobs(),
    videos(),
    transcripts(),
    libraryLinks(),
  ];
}

function creators() {
  return {
    name: 'creators',
    label: '关注的博主',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'sec_uid', type: 'string', label: 'sec_uid', indexed: true },
      { name: 'uid', type: 'string', label: 'uid', indexed: true },
      { name: 'nickname', type: 'string', label: '昵称', required: true, indexed: true },
      { name: 'avatar', type: 'string', label: '头像 URL' },
      { name: 'follow_count', type: 'integer', label: '粉丝数', default: 0 },
      {
        name: 'cadence',
        type: 'enum',
        label: '巡更频率',
        options: ['hourly', 'daily', 'weekly', 'manual'],
        default: 'daily',
        indexed: true,
      },
      { name: 'last_checked_at', type: 'datetime', label: '最近巡更', indexed: true },
      { name: 'last_failure_reason', type: 'text', label: '失败原因' },
      { name: 'enabled', type: 'boolean', label: '启用', default: true, indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['cadence'], ['enabled'], ['updated_at']],
  };
}

function keywords() {
  return {
    name: 'keywords',
    label: '关键词订阅',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'query', type: 'string', label: '关键词', required: true, indexed: true },
      {
        name: 'time_window',
        type: 'enum',
        label: '时间窗',
        options: ['day', 'week', 'month', 'all'],
        default: 'week',
      },
      { name: 'dedupe_window_days', type: 'integer', label: '去重天数', default: 30 },
      {
        name: 'cadence',
        type: 'enum',
        label: '巡更频率',
        options: ['hourly', 'daily', 'weekly', 'manual'],
        default: 'manual',
        indexed: true,
      },
      { name: 'last_checked_at', type: 'datetime', label: '最近巡更' },
      { name: 'enabled', type: 'boolean', label: '启用', default: true, indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['enabled'], ['updated_at']],
  };
}

function collectJobs() {
  return {
    name: 'collect_jobs',
    label: '采集任务',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      {
        name: 'kind',
        type: 'enum',
        label: '类型',
        options: ['creator', 'keyword', 'link'],
        required: true,
        indexed: true,
      },
      { name: 'target_ref', type: 'string', label: '目标', indexed: true },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['queued', 'running', 'success', 'failed', 'cancelled'],
        default: 'queued',
        indexed: true,
      },
      { name: 'started_at', type: 'datetime', label: '开始时间' },
      { name: 'ended_at', type: 'datetime', label: '结束时间' },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'discovered_count', type: 'integer', label: '发现条数', default: 0 },
      { name: 'transcribed_count', type: 'integer', label: '已转写', default: 0 },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['status'], ['kind'], ['updated_at']],
  };
}

function videos() {
  return {
    name: 'videos',
    label: '已采集视频',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'aweme_id', type: 'string', label: 'aweme_id', required: true, indexed: true },
      { name: 'creator_ref', type: 'string', label: '博主 ID', indexed: true },
      { name: 'creator_nickname', type: 'string', label: '博主', indexed: true },
      { name: 'title', type: 'string', label: '标题', indexed: true },
      { name: 'cover', type: 'string', label: '封面 URL' },
      { name: 'duration_seconds', type: 'integer', label: '时长（秒）', default: 0, indexed: true },
      {
        name: 'duration_bucket',
        type: 'enum',
        label: '时长档',
        options: ['short', 'medium', 'long'],
        default: 'short',
        indexed: true,
      },
      { name: 'language', type: 'string', label: '语言', default: 'zh-CN', indexed: true },
      {
        name: 'subtitle_source',
        type: 'enum',
        label: '字幕来源',
        options: ['none', 'native', 'asr-douyin', 'asr-local'],
        default: 'none',
        indexed: true,
      },
      { name: 'native_subtitle_urls', type: 'text', label: '原生字幕 URL（JSON 数组）' },
      { name: 'play_addr_urls', type: 'text', label: '播放地址（JSON 数组，仅 ASR 兜底用）' },
      { name: 'last_discuss_session_id', type: 'string', label: '最近讨论会话 ID' },
      { name: 'last_discuss_at', type: 'datetime', label: '最近讨论时间' },
      {
        name: 'transcript_status',
        type: 'enum',
        label: '转写状态',
        options: ['pending', 'running', 'success', 'failed'],
        default: 'pending',
        indexed: true,
      },
      { name: 'summary', type: 'text', label: 'AI 摘要' },
      { name: 'tags', type: 'text', label: '标签（JSON 数组）' },
      { name: 'chapters', type: 'text', label: '章节切分（JSON 数组）' },
      {
        name: 'library_status',
        type: 'enum',
        label: '入库状态',
        options: ['unprocessed', 'draft', 'published', 'discarded'],
        default: 'unprocessed',
        indexed: true,
      },
      { name: 'library_collection_id', type: 'string', label: '入库 collection' },
      { name: 'notes', type: 'text', label: '用户备注' },
      { name: 'starred', type: 'boolean', label: '加星 / 重点回看', default: false },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['library_status'], ['transcript_status'], ['creator_ref'], ['updated_at'], ['starred']],
  };
}

function transcripts() {
  return {
    name: 'transcripts',
    label: '字幕 / 转写',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'video_ref', type: 'string', label: '视频 ID', required: true, indexed: true },
      { name: 'lang', type: 'string', label: '语言', default: 'zh-CN' },
      {
        name: 'source',
        type: 'enum',
        label: '来源',
        options: ['native', 'asr-douyin', 'asr-local'],
        required: true,
        indexed: true,
      },
      { name: 'segments', type: 'text', label: '分段（JSON 数组）' },
      { name: 'word_count', type: 'integer', label: '字数', default: 0 },
      { name: 'confidence', type: 'integer', label: '置信度', default: 0 },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['video_ref'], ['source'], ['updated_at']],
  };
}

function libraryLinks() {
  return {
    name: 'library_links',
    label: '资料库链接',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'video_ref', type: 'string', label: '视频 ID', required: true, indexed: true },
      { name: 'collection_id', type: 'string', label: 'Knowledge collection', required: true, indexed: true },
      { name: 'chunk_id', type: 'string', label: 'Chunk ID', indexed: true },
      { name: 'pushed_at', type: 'datetime', label: '入库时间', indexed: true },
      { name: 'version', type: 'integer', label: '版本', default: 1 },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['video_ref'], ['collection_id'], ['pushed_at']],
  };
}

/**
 * Pages exist to satisfy the manifest validator (pages must include a
 * `layout` and only valid widgets per resources/app-schemas/page.schema.json).
 * They are NOT actually rendered — DouyinCollectorApp.tsx is a custom
 * React shell that takes over for this app. Keep these declarative pages
 * minimal: just enough to pass schema validation so install succeeds.
 */
export function buildDouyinPages(): Record<string, unknown> {
  const placeholder = (title: string, summary: string) => ({
    title,
    layout: 'single' as const,
    blocks: [
      {
        type: 'markdown' as const,
        content: summary,
      },
    ],
  });
  return {
    'pages/sources.json': placeholder(
      '采集来源（博主 / 关键词）',
      [
        '- 仅采集**公开视频元数据 / 字幕 / 封面**；不下载视频文件用作分发。',
        '- 字幕优先级：抖音原生字幕 → 抖音 ASR → Lumos speech-to-text MCP 兜底。',
        '- 触发风控时立即停止后续 job，状态进入 needs_auth；不绕过任何风控措施。',
      ].join('\n'),
    ),
    'pages/jobs.json': placeholder('采集任务', '当前应用采集任务的列表与状态。'),
    'pages/library.json': placeholder('资料库', '已采集视频的资料列表。'),
    'pages/organize.json': placeholder(
      '整理 / 入库',
      '逐条整理：播放器 + 字幕 + AI 摘要 + 标签编辑 + 入库到 knowledge collection。批量入库前必须二次确认。',
    ),
  };
}
