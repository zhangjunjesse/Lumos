/**
 * X 雷达 builder template 的业务集合 + 业务页面 placeholder。
 * 完整声明式页面参考 apps/x-radar/pages/*.json；这里只放过 schema 校验所需的最小骨架，
 * 实际 UI 由用户在 builder 安装后扩展。
 */

export function buildXRadarCollections(): unknown[] {
  return [
    radarTasks(),
    radarAlerts(),
    topicReports(),
    followDigests(),
    statsReports(),
    taskEvidenceRefs(),
    tweetEvidence(),
  ];
}

function taskEvidenceRefs() {
  return {
    name: 'task_evidence_refs',
    label: '任务抓取明细',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'tweet_id', type: 'string', label: '推文 ID（关联 tweet_evidence）', required: true, indexed: true },
      { name: 'matched_at', type: 'datetime', label: '抓取时间', indexed: true },
      { name: 'kind', type: 'enum', label: '模板类型', options: ['monitor', 'topic', 'digest', 'stats'], indexed: true },
    ],
    indexes: [['task_ref'], ['tweet_id'], ['matched_at']],
  };
}

function radarTasks() {
  return {
    name: 'radar_tasks',
    label: '任务',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'name', type: 'string', label: '任务名', required: true, indexed: true },
      { name: 'kind', type: 'enum', label: '模板类型', options: ['monitor', 'topic', 'digest', 'stats'], required: true, indexed: true },
      { name: 'enabled', type: 'boolean', label: '启用', default: false, indexed: true },
      { name: 'cadence', type: 'enum', label: '执行频率', options: ['hourly', 'every_6_hours', 'daily', 'weekly', 'manual'], default: 'manual', indexed: true },
      { name: 'config_json', type: 'text', label: '模板配置（JSON）' },
      { name: 'last_run_id', type: 'string', label: '最近运行记录' },
      { name: 'last_run_started_at', type: 'datetime', label: '最近运行开始时间', indexed: true },
      { name: 'last_status', type: 'enum', label: '最近状态', options: ['not_connected', 'idle', 'running', 'success', 'failed', 'cancelled'], default: 'not_connected', indexed: true },
      { name: 'last_summary', type: 'text', label: '最近结果摘要' },
      { name: 'last_failure_reason', type: 'text', label: '最近失败原因' },
      { name: 'next_run_at', type: 'datetime', label: '下次运行时间' },
      { name: 'schedule_id', type: 'string', label: '调度任务 ID' },
      { name: 'schedule_status', type: 'enum', label: '调度状态', options: ['not_connected', 'scheduled', 'paused', 'failed'], default: 'not_connected', indexed: true },
      { name: 'schedule_error', type: 'text', label: '调度失败原因' },
      { name: 'im_enabled', type: 'boolean', label: '推 IM', default: false },
      { name: 'im_target_label', type: 'string', label: 'IM 目标' },
      { name: 'report_format', type: 'enum', label: '报告格式', options: ['poster', 'image', 'docx'], default: 'poster' },
      { name: 'report_style', type: 'enum', label: '图片样式', options: ['business', 'minimal', 'magazine', 'dark'], default: 'business' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['kind'], ['enabled'], ['cadence'], ['last_status'], ['updated_at']],
  };
}

function radarAlerts() {
  return {
    name: 'radar_alerts',
    label: '监控告警',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'tweet_id', type: 'string', label: '推文 ID', required: true, indexed: true },
      { name: 'matched_rule', type: 'string', label: '命中规则' },
      { name: 'author_screen', type: 'string', label: '作者 @', indexed: true },
      { name: 'author_name', type: 'string', label: '作者昵称' },
      { name: 'tweet_text', type: 'text', label: '推文正文' },
      { name: 'tweet_url', type: 'string', label: '推文链接' },
      { name: 'tweet_created_at', type: 'datetime', label: '推文时间', indexed: true },
      { name: 'like_count', type: 'integer', label: '点赞数', default: 0 },
      { name: 'retweet_count', type: 'integer', label: '转推数', default: 0 },
      { name: 'reply_count', type: 'integer', label: '回复数', default: 0 },
      { name: 'view_count', type: 'integer', label: '浏览数', default: 0 },
      { name: 'status', type: 'enum', label: '处理状态', options: ['pending', 'notified', 'dismissed'], default: 'pending', indexed: true },
      { name: 'notification_id', type: 'string', label: '关联通知' },
      { name: 'hit_at', type: 'datetime', label: '命中时间', indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['tweet_id'], ['status'], ['hit_at']],
  };
}

function topicReports() {
  return {
    name: 'topic_reports',
    label: '选题报告',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'topic', type: 'string', label: '选题主题', indexed: true },
      { name: 'report_md', type: 'text', label: '报告内容（Markdown）' },
      { name: 'sources_json', type: 'text', label: '来源 URL 列表（JSON 数组）' },
      { name: 'evidence_count', type: 'integer', label: '证据条数', default: 0 },
      { name: 'library_status', type: 'enum', label: '入库状态', options: ['unprocessed', 'draft', 'published', 'discarded'], default: 'unprocessed', indexed: true },
      { name: 'library_collection_id', type: 'string', label: '入库 collection' },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'created_at', type: 'datetime', label: '生成时间', indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['topic'], ['library_status'], ['created_at']],
  };
}

function followDigests() {
  return {
    name: 'follow_digests',
    label: '关注摘要',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'window_kind', type: 'enum', label: '窗口', options: ['daily', 'weekly'], default: 'daily', indexed: true },
      { name: 'window_start', type: 'datetime', label: '起始', indexed: true },
      { name: 'window_end', type: 'datetime', label: '结束' },
      { name: 'summary_md', type: 'text', label: '摘要正文（Markdown）' },
      { name: 'accounts_json', type: 'text', label: '覆盖账号（JSON 数组）' },
      { name: 'account_count', type: 'integer', label: '账号数', default: 0 },
      { name: 'tweet_count', type: 'integer', label: '原推数', default: 0 },
      { name: 'library_status', type: 'enum', label: '入库状态', options: ['unprocessed', 'draft', 'published', 'discarded'], default: 'unprocessed' },
      { name: 'library_collection_id', type: 'string', label: '入库 collection' },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['window_kind'], ['window_start']],
  };
}

function statsReports() {
  return {
    name: 'stats_reports',
    label: '数据拆解',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'target', type: 'string', label: '目标（账号或话题）', indexed: true },
      { name: 'metrics_json', type: 'text', label: '指标（JSON）' },
      { name: 'top_threads_json', type: 'text', label: '热门 thread（JSON 数组）' },
      { name: 'report_md', type: 'text', label: '报告（Markdown）' },
      { name: 'sample_start', type: 'datetime', label: '采样起始' },
      { name: 'sample_end', type: 'datetime', label: '采样结束' },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'created_at', type: 'datetime', label: '生成时间', indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['target'], ['created_at']],
  };
}

function tweetEvidence() {
  return {
    name: 'tweet_evidence',
    label: '原推快照',
    fields: [
      { name: 'id', type: 'string', label: '推文 ID', primary: true },
      { name: 'author_screen', type: 'string', label: '作者 @', indexed: true },
      { name: 'author_name', type: 'string', label: '作者昵称' },
      { name: 'text', type: 'text', label: '正文' },
      { name: 'tweet_created_at', type: 'datetime', label: '发布时间', indexed: true },
      { name: 'like_count', type: 'integer', label: '点赞数', default: 0 },
      { name: 'retweet_count', type: 'integer', label: '转推数', default: 0 },
      { name: 'reply_count', type: 'integer', label: '回复数', default: 0 },
      { name: 'view_count', type: 'integer', label: '浏览数', default: 0 },
      { name: 'quote_count', type: 'integer', label: '引用数', default: 0 },
      { name: 'url', type: 'string', label: '链接' },
      { name: 'conversation_id', type: 'string', label: 'thread 头', indexed: true },
      { name: 'photos_json', type: 'text', label: '图片 URL（JSON 数组）' },
      { name: 'video_previews_json', type: 'text', label: '视频预览 URL（JSON 数组）' },
      { name: 'snapshot_at', type: 'datetime', label: '快照时间', indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['author_screen'], ['tweet_created_at'], ['snapshot_at']],
  };
}

/**
 * 业务页面 placeholder — 只为过 page schema 校验。安装后用户可参考
 * apps/x-radar/pages/ 下完整业务页面把这些 placeholder 替换为真实 UI。
 */
export function buildXRadarPages(): Record<string, unknown> {
  const placeholder = (title: string, summary: string) => ({
    title,
    layout: 'single' as const,
    blocks: [{ type: 'markdown' as const, content: summary }],
  });
  return {
    'pages/tasks.json': placeholder('任务工作台', '新建监控雷达 / 选题挖掘 / 关注摘要 / 数据拆解任务；每个任务挑一种 kind + 填 config_json + 决定 cadence 与 im_enabled。'),
    'pages/alerts.json': placeholder('监控告警', '监控雷达任务命中后落 radar_alerts；按需推 IM 走 app_notifications。'),
    'pages/reports.json': placeholder('选题报告', '选题挖掘任务的 Markdown 报告（report_md），AI 模块未接入前显示 failure_reason；引用来源 URL 必须真实可点。'),
    'pages/digests.json': placeholder('关注摘要', '关注摘要任务的日报 / 周报简报，AI 模块未接入前显示 failure_reason；账号没新推时如实显示 0。'),
    'pages/stats.json': placeholder('数据拆解', '数据拆解任务的指标与热门 thread；指标基于实际原推，0 也展示 0，不允许 mock。'),
    'pages/evidence.json': placeholder('原推快照', '所有任务引用的原推共用快照表，同一条不会重复抓只覆盖更新 snapshot_at。'),
  };
}
