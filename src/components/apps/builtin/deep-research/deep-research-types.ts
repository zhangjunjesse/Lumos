export const APP_ID = 'deep-research';

export type DeepResearchTab =
  | 'tasks'
  | 'pipeline'
  | 'settings'
  | 'automations'
  | 'im'
  | 'run-history';

export type ResearchStage =
  | 'clarifying'
  | 'goal_review'
  | 'planning'
  | 'risk_review'
  | 'collecting'
  | 'synthesizing'
  | 'outline_review'
  | 'drafting'
  | 'qa'
  | 'delivered'
  | 'blocked';

export interface ResearchTaskRow {
  id: string;
  title?: string;
  audience?: string;
  purpose?: string;
  style?: string;
  language?: string;
  length_target?: string;
  deadline?: string | null;
  stage?: ResearchStage;
  status?: 'active' | 'paused' | 'failed' | 'delivered' | 'cancelled';
  blocking_reason?: string;
  last_advance_at?: string | null;
  failure_reason?: string;
  updated_at?: string;
}

export interface ResearchBriefRow {
  id: string;
  task_ref: string;
  audience?: string;
  purpose?: string;
  scope_in?: string;
  scope_out?: string;
  depth_target?: string;
  tone?: string;
  open_questions?: string;
  status?: 'drafting' | 'pending_user_accept' | 'accepted' | 'rejected';
  accepted_at?: string | null;
  updated_at?: string;
}

export interface ResearchGoalRow {
  id: string;
  task_ref: string;
  smart_goal?: string;
  success_criteria?: string;
  out_of_scope?: string;
  deliverables?: string;
  status?: 'drafting' | 'pending_user_accept' | 'accepted' | 'rejected';
  accepted_at?: string | null;
}

export interface ResearchQuestionRow {
  id: string;
  task_ref: string;
  parent_ref?: string | null;
  order_index?: number;
  question: string;
  evidence_requirements?: string;
  verification_criteria?: string;
  evidence_target_count?: number;
  status?: 'draft' | 'collecting' | 'needs_more_evidence' | 'synthesized' | 'blocked';
}

export interface ResearchRiskRow {
  id: string;
  task_ref: string;
  category?: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  mitigation?: string;
  status?: 'open' | 'mitigated' | 'accepted' | 'blocked';
}

export interface ResearchSourceRow {
  id: string;
  task_ref: string;
  kind?: string;
  target?: string;
  config?: string;
  status?: 'not_connected' | 'ready' | 'syncing' | 'success' | 'failed' | 'paused';
  last_run_at?: string | null;
  last_failure_reason?: string;
  discovered_count?: number;
  enabled?: boolean;
}

export interface ResearchEvidenceRow {
  id: string;
  task_ref: string;
  question_ref?: string;
  source_ref?: string;
  source_kind?: string;
  url?: string;
  title?: string;
  author?: string;
  published_at?: string | null;
  snippet?: string;
  confidence?: 'low' | 'medium' | 'high';
  status?: 'collected' | 'dedup_pending' | 'duplicate' | 'used' | 'discarded';
  collected_at?: string;
}

export interface ResearchReportRow {
  id: string;
  task_ref: string;
  version?: number;
  kind?: 'outline' | 'section_draft' | 'full_draft' | 'final';
  title?: string;
  content_md?: string;
  sections_json?: string;
  status?: 'drafting' | 'pending_user_accept' | 'accepted' | 'rejected' | 'qa_failed';
  qa_summary?: string;
}

export interface ResearchSettings {
  default_view?: string;
  notification_channel?: string;
  ai_system_prompt?: string;
  automation_enabled?: boolean;
  risk_note?: string;
  updated_at?: string;
}

export const STAGE_ORDER: ResearchStage[] = [
  'clarifying',
  'goal_review',
  'planning',
  'risk_review',
  'collecting',
  'synthesizing',
  'outline_review',
  'drafting',
  'qa',
  'delivered',
];

export const STAGE_LABEL: Record<ResearchStage, string> = {
  clarifying: '需求澄清',
  goal_review: '目标确认',
  planning: '任务拆解',
  risk_review: '风险分析',
  collecting: '资料采集',
  synthesizing: '综合分析',
  outline_review: '大纲确认',
  drafting: '章节草稿',
  qa: '自检验收',
  delivered: '已交付',
  blocked: '已阻塞',
};

export const STAGE_DESCRIPTION: Record<ResearchStage, string> = {
  clarifying: '与 AI 多轮对话明确读者 / 用途 / 范围 / 深度 / 长度 / 语气 / 审美样章。',
  goal_review: '产出 SMART 目标书 + 成功标准 + 明确不做；用户接受后才推进。',
  planning: '把目标拆为 ≤8 顶级研究问题，每题含子问题与验证标准。',
  risk_review: '识别资料稀缺 / 付费墙 / 敏感话题 / 时效 / 配额等风险并给出降级方案。',
  collecting:
    '多源并行采集：deepsearch（公网 / 知乎 / 微信公众号）+ 抖音 + bilibili + 知识库；每条证据带 URL / 摘要 / 置信度。',
  synthesizing:
    '按研究问题汇总证据 → AI 综合答案 → 标注未决问题；证据条数不达标显示 needs_more_evidence。',
  outline_review: '生成报告大纲（每章对应研究问题），用户接受后才进入章节草稿。',
  drafting: '分章节流式生成草稿，每段引用 evidence_id；终稿写入后跑自检。',
  qa: '引用完整性 / 未决问题 / 长度 / 问题树覆盖度自检；不通过回到 collecting 或 synthesizing。',
  delivered: '用户最终接受，调研任务完成。',
  blocked: '关键能力不可达或用户暂停；查看风险登记册了解原因。',
};

export const STYLE_OPTIONS = ['克制学术', '行业研究', '投资人友好', '中文长文', '简报', '自定义'];

export const SOURCE_KIND_LABEL: Record<string, string> = {
  deepsearch: 'DeepSearch（公网 / 知乎 / 微信公众号）',
  douyin_creator: '抖音博主',
  douyin_keyword: '抖音关键词',
  bilibili: 'Bilibili',
  knowledge_collection: '内部知识库',
  manual_url: '手动 URL',
  mcp: 'MCP 工具',
};
