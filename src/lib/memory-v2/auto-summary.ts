import path from 'path';
import { getDb, getSetting, setSetting } from '@/lib/db';
import { parseMessageContent, type ChatSession, type MessageContentBlock } from '@/types';
import { isMainAgentSession } from '@/lib/chat/session-entry';
import { isWeChatAssistantChatSession } from '@/lib/chat/wechat-assistant-session';
import { isWorkflowChatSession } from '@/lib/chat/workflow-session';
import { createMemoryV2Entry } from './store';
import { processMemoryV2ResourceSecrets } from './resource-secrets';
import type { MemoryV2Entry, MemoryV2Kind, MemoryV2ScopeType } from './types';

const LAST_ROWID_KEY = 'memory_v2_auto_summary_last_message_rowid';
const SOURCE_TYPE = 'memory_v2_sleep_auto_summary';
const FIRST_SCAN_HOURS = 24;

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  _rowid: number;
  session_title: string;
  mode: string;
  working_directory: string;
  sdk_cwd: string;
  project_name: string;
}

interface AutoMemoryCandidate {
  kind: MemoryV2Kind;
  title: string;
  body: string;
  tags: string[];
  importance: number;
  confidence: number;
}

export interface MemoryV2AutoSummaryResult {
  scanned: number;
  considered: number;
  created: MemoryV2Entry[];
  maxRowId: number;
}

function compact(value: string, max = 420): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function cleanMessageText(content: string): string {
  const withoutFilePrefix = content.replace(/^<!--files:[\s\S]*?-->/, '').trim();
  let blocks: MessageContentBlock[];
  try {
    blocks = parseMessageContent(withoutFilePrefix);
  } catch {
    return compact(withoutFilePrefix, 1600);
  }
  return compact(
    blocks
      .map((block) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'code') return block.code;
        return '';
      })
      .filter(Boolean)
      .join('\n'),
    1600,
  );
}

function isExplicitMemoryRequest(text: string): boolean {
  return /(?:^|\s)(记住|记一下|记录一下|保存为记忆|以后记得|请记得|下次记得)\b/i.test(text)
    || /\b(remember|note this|save this|from now on)\b/i.test(text);
}

function titleFor(kind: MemoryV2Kind, text: string): string {
  const labels: Record<MemoryV2Kind, string> = {
    task: '任务进展',
    people: '用户偏好',
    resource: '资源信息',
    capability: '能力缺口',
    reflection: '经验复盘',
  };
  return `睡眠提炼：${labels[kind]}：${compact(text, 40)}`;
}

function inferCandidate(text: string): AutoMemoryCandidate | null {
  if (!text || text.length < 8) return null;
  if (isExplicitMemoryRequest(text)) return null;
  if (/^(你好|谢谢|好的|可以|嗯|ok|OK|收到|继续|先这样|测试)$/i.test(text.trim())) return null;

  const resource = /(密码|口令|token|api\s*key|密钥|令牌|cookie|登录态|账号|服务器|ssh|数据库|素材|文件路径|资源|权限|credential|secret|vault)/i;
  const capability = /(能力缺口|补齐能力|自我改进|自我提升|需要.*(工具|能力|插件|skill|mcp)|缺少.*(工具|能力|插件|skill|mcp)|无法.*(调用|获取|处理|检索|查询|导出|同步|自动化))/i;
  const people = /(我喜欢|我希望|我偏好|我的身份|我是|以后.*(要|不要|别)|下次.*(要|不要|别)|不要.*(问|点|确认|手动|啰嗦|空泛)|沟通方式|期望值|用户偏好|风格)/i;
  const reflection = /(复盘|教训|踩坑|失败原因|下次.*避免|这次.*问题|以后避免|经验|自省)/i;
  const task = /(目标|背景|任务|项目|分支|需求|验收|计划|决定|决策|先做|暂不做|下一步|进度|上线|部署|测试|构建|实现)/i;

  let kind: MemoryV2Kind | null = null;
  if (resource.test(text)) kind = 'resource';
  else if (capability.test(text)) kind = 'capability';
  else if (people.test(text)) kind = 'people';
  else if (reflection.test(text)) kind = 'reflection';
  else if (task.test(text)) kind = 'task';
  if (!kind) return null;

  const tags = new Set<string>(['auto-summary', kind]);
  if (/偏好|喜欢|希望|不要|别|沟通|风格/.test(text)) tags.add('preference');
  if (/项目|repo|分支|代码|构建|测试|部署/.test(text)) tags.add('project');
  if (/密码|token|密钥|cookie|登录态|权限/.test(text)) tags.add('security');
  if (/skill|mcp|工具|能力/.test(text)) tags.add('capability');

  return {
    kind,
    title: titleFor(kind, text),
    body: compact(text, 1200),
    tags: Array.from(tags),
    importance: kind === 'resource' ? 5 : kind === 'capability' || kind === 'task' ? 4 : 3,
    confidence: kind === 'resource' || kind === 'people' ? 0.86 : 0.78,
  };
}

function ownerModuleFor(session: ChatSession): string {
  if (isWorkflowChatSession(session)) return 'workflow';
  if (isWeChatAssistantChatSession(session)) return 'wechat-assistant';
  if (isMainAgentSession(session)) return 'main-agent';
  if (session.sdk_cwd || session.working_directory) return 'project-chat';
  return 'chat';
}

function scopeFor(candidate: AutoMemoryCandidate, session: ChatSession, text: string): {
  scopeType: MemoryV2ScopeType;
  scopeKey: string;
  projectPath: string;
} {
  const projectPath = (session.sdk_cwd || session.working_directory || '').trim();
  if (candidate.kind === 'people') {
    return { scopeType: 'user', scopeKey: 'default', projectPath };
  }
  if (candidate.kind === 'capability' && isMainAgentSession(session)) {
    return { scopeType: 'main_agent', scopeKey: 'main', projectPath };
  }
  if (projectPath && /(这个项目|当前项目|本项目|项目|repo|代码|分支|构建|测试|部署|目录)/i.test(text)) {
    return { scopeType: 'project', scopeKey: projectPath, projectPath };
  }
  if (isMainAgentSession(session)) {
    return { scopeType: 'main_agent', scopeKey: 'main', projectPath };
  }
  return { scopeType: 'session', scopeKey: session.id, projectPath };
}

function alreadyCaptured(messageId: string): boolean {
  const row = getDb().prepare(
    'SELECT id FROM memory_v2_entries WHERE source_type = ? AND source_id = ? LIMIT 1',
  ).get(SOURCE_TYPE, messageId) as { id: string } | undefined;
  return Boolean(row);
}

function getLastRowId(): number {
  const raw = Number(getSetting(LAST_ROWID_KEY) || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function listNewUserMessages(lastRowId: number, limit: number): MessageRow[] {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const firstScanCutoff = new Date(Date.now() - FIRST_SCAN_HOURS * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .split('.')[0];
  const firstScanClause = lastRowId > 0 ? '' : 'AND m.created_at >= ?';
  const args: unknown[] = lastRowId > 0
    ? [lastRowId, safeLimit]
    : [lastRowId, firstScanCutoff, safeLimit];
  return getDb().prepare(
    `SELECT
       m.id,
       m.session_id,
       m.role,
       m.content,
       m.created_at,
       m.rowid AS _rowid,
       COALESCE(s.title, '') AS session_title,
       COALESCE(s.mode, '') AS mode,
       COALESCE(s.working_directory, '') AS working_directory,
       COALESCE(s.sdk_cwd, '') AS sdk_cwd,
       COALESCE(s.project_name, '') AS project_name
     FROM messages m
     LEFT JOIN chat_sessions s ON s.id = m.session_id
     WHERE m.rowid > ?
       AND m.role = 'user'
       ${firstScanClause}
     ORDER BY m.rowid ASC
     LIMIT ?`,
  ).all(...args) as MessageRow[];
}

function rowToSession(row: MessageRow): ChatSession {
  return {
    id: row.session_id,
    title: row.session_title,
    created_at: '',
    updated_at: '',
    model: '',
    requested_model: '',
    resolved_model: '',
    system_prompt: '',
    working_directory: row.working_directory,
    sdk_session_id: '',
    project_name: row.project_name || path.basename(row.sdk_cwd || row.working_directory || ''),
    status: 'active',
    mode: (row.mode || 'code') as ChatSession['mode'],
    provider_name: '',
    provider_id: '',
    browser_context_id: '',
    sdk_cwd: row.sdk_cwd,
    runtime_status: '',
    runtime_updated_at: '',
    runtime_error: '',
    folder: '',
    knowledge_enabled: 0,
    knowledge_tag_ids: '[]',
    knowledge_overrides: '{}',
  };
}

export function summarizeNewMemoryV2FromMessages(params: {
  limit?: number;
} = {}): MemoryV2AutoSummaryResult {
  const lastRowId = getLastRowId();
  const rows = listNewUserMessages(lastRowId, params.limit ?? 160);
  let maxRowId = lastRowId;
  let considered = 0;
  const created: MemoryV2Entry[] = [];

  for (const row of rows) {
    maxRowId = Math.max(maxRowId, row._rowid);
    const text = cleanMessageText(row.content);
    const candidate = inferCandidate(text);
    if (!candidate || alreadyCaptured(row.id)) continue;
    considered += 1;

    const session = rowToSession(row);
    const ownerModule = ownerModuleFor(session);
    const scope = scopeFor(candidate, session, text);
    const redacted = processMemoryV2ResourceSecrets(candidate.body, {
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
      ownerModule,
      sessionId: row.session_id,
      messageId: row.id,
      projectPath: scope.projectPath,
      sourceType: SOURCE_TYPE,
      sourceId: row.id,
    });

    created.push(createMemoryV2Entry({
      kind: candidate.kind,
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
      ownerModule,
      status: 'active',
      title: titleFor(candidate.kind, redacted.text),
      body: redacted.text,
      summary: compact(redacted.text, 260),
      tags: candidate.tags,
      sourceType: SOURCE_TYPE,
      sourceId: row.id,
      sessionId: row.session_id,
      messageId: row.id,
      projectPath: scope.projectPath,
      sensitivity: redacted.sensitivity,
      secretRef: redacted.secretRefs[0],
      confidence: candidate.confidence,
      importance: redacted.sensitivity !== 'normal' ? 5 : candidate.importance,
      evidence: `睡眠从新增对话自动提炼。消息时间：${row.created_at}`,
      metadata: {
        capture: 'sleep-auto-summary',
        sourceRowId: row._rowid,
        sessionTitle: row.session_title,
        secretRefs: redacted.secretRefs,
      },
    }));
  }

  if (maxRowId > lastRowId) {
    setSetting(LAST_ROWID_KEY, String(maxRowId));
  }

  return {
    scanned: rows.length,
    considered,
    created,
    maxRowId,
  };
}
