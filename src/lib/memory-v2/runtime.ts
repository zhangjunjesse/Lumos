import path from 'path';
import { getSession } from '@/lib/db';
import { isMainAgentSession } from '@/lib/chat/session-entry';
import { isWorkflowChatSession } from '@/lib/chat/workflow-session';
import { isWeChatAssistantChatSession } from '@/lib/chat/wechat-assistant-session';
import {
  createMemoryV2Entry,
  listMemoryV2ForScopes,
  parseMemoryV2Tags,
  touchMemoryV2Usage,
} from './store';
import { processMemoryV2ResourceSecrets } from './resource-secrets';
import type {
  MemoryV2Entry,
  MemoryV2Input,
  MemoryV2Kind,
  MemoryV2Pack,
  MemoryV2Scope,
  MemoryV2ScopeType,
} from './types';

const EXPLICIT_MEMORY_PATTERNS = [
  /(?:^|\s)(记住|记一下|记录一下|保存为记忆|以后记得|请记得|下次记得)/i,
  /\b(remember|note this|save this|from now on)\b/i,
];

const PREFIX_CLEANUP_PATTERNS = [
  /^(请|麻烦)?(帮我)?(记住|记一下|记录一下|保存为记忆)(一下)?[:：,\s]*/i,
  /^(以后|下次)(请)?(记得|要|不要)[:：,\s]*/i,
  /^(remember|note this|save this|from now on)\s*[:：,-]?\s*/i,
];

function compact(value: string, max = 360): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function hasExplicitMemoryIntent(text: string): boolean {
  const value = text.trim();
  if (!value || value.length < 4) return false;
  return EXPLICIT_MEMORY_PATTERNS.some((pattern) => pattern.test(value));
}

function stripExplicitPrefix(text: string): string {
  let value = text.trim();
  for (const pattern of PREFIX_CLEANUP_PATTERNS) {
    value = value.replace(pattern, '');
  }
  return value.replace(/\s+/g, ' ').trim();
}

function inferKind(text: string): MemoryV2Kind {
  if (/(密码|口令|token|api\s*key|密钥|令牌|cookie|登录态|账号|服务器|ssh|数据库|素材|文件路径|资源|权限|credential|secret|vault)/i.test(text)) {
    return 'resource';
  }
  if (/(能力|skill|mcp|工具|agent|会用|不会|安装|配置|补能力|自我提升|capability)/i.test(text)) {
    return 'capability';
  }
  if (/(用户|我喜欢|我希望|偏好|身份|角色|沟通|期望|参与方|负责人|决策人|不要空泛|风格)/i.test(text)) {
    return 'people';
  }
  if (/(复盘|教训|踩坑|经验|下次.*避免|自省|失败原因|lesson|reflection)/i.test(text)) {
    return 'reflection';
  }
  return 'task';
}

function inferTags(text: string, kind: MemoryV2Kind): string[] {
  const tags = new Set<string>([kind]);
  const rules: Array<[string, RegExp]> = [
    ['goal', /目标|成功标准|验收|goal/i],
    ['decision', /决定|决策|先做|不做|不要|优先/i],
    ['resource', /资源|账号|服务器|登录态|token|密码|素材/i],
    ['security', /密码|token|密钥|secret|cookie|权限/i],
    ['workflow', /工作流|workflow|自动化|schedule/i],
    ['app-builder', /app builder|应用|builder|native-app-spec/i],
    ['wechat', /微信|群|联系人|wechat/i],
    ['goofish', /闲鱼|goofish|买家|商品/i],
    ['capability', /能力|skill|mcp|工具|agent/i],
    ['preference', /偏好|喜欢|希望|风格|沟通/i],
  ];
  for (const [tag, pattern] of rules) {
    if (pattern.test(text)) tags.add(tag);
  }
  return Array.from(tags).slice(0, 12);
}

function titleFromContent(content: string, kind: MemoryV2Kind): string {
  const label: Record<MemoryV2Kind, string> = {
    task: '任务记忆',
    people: '人和角色',
    resource: '资源记忆',
    capability: '能力记忆',
    reflection: '复盘记忆',
  };
  const first = compact(content, 44);
  return first ? `${label[kind]}：${first}` : label[kind];
}

function normalizeProjectPath(projectPath?: string): string {
  return projectPath?.trim() || '';
}

function projectScopeKey(projectPath: string): string {
  return projectPath || '';
}

function inferOwnerModule(params: {
  mainAgent: boolean;
  workflowChat: boolean;
  wechatChat: boolean;
  projectPath: string;
}): string {
  if (params.workflowChat) return 'workflow';
  if (params.wechatChat) return 'wechat-assistant';
  if (params.mainAgent) return 'main-agent';
  if (params.projectPath) return 'project-chat';
  return 'chat';
}

function inferScope(params: {
  content: string;
  kind: MemoryV2Kind;
  sessionId: string;
  projectPath: string;
  mainAgent: boolean;
  ownerModule: string;
}): { scopeType: MemoryV2ScopeType; scopeKey: string } {
  const text = params.content;
  if (/当前会话|这次对话|本轮|临时|只在这次|session/i.test(text)) {
    return { scopeType: 'session', scopeKey: params.sessionId };
  }
  if (/所有项目|以后所有|全局|我总是|我一直|我的偏好|我的身份|用户偏好|global/i.test(text)) {
    return { scopeType: 'user', scopeKey: 'default' };
  }
  if (params.projectPath && /(这个项目|当前项目|本项目|repo|代码库|分支|构建|测试|发布|目录|项目)/i.test(text)) {
    return { scopeType: 'project', scopeKey: projectScopeKey(params.projectPath) };
  }
  if (params.kind === 'people') {
    return { scopeType: 'user', scopeKey: 'default' };
  }
  if (params.projectPath && !params.mainAgent) {
    return { scopeType: 'project', scopeKey: projectScopeKey(params.projectPath) };
  }
  if (params.ownerModule !== 'chat') {
    return { scopeType: 'module', scopeKey: params.ownerModule };
  }
  return { scopeType: 'session', scopeKey: params.sessionId };
}

export function buildMemoryV2Scopes(params: {
  sessionId: string;
  projectPath?: string;
  mainAgent?: boolean;
  ownerModule?: string;
}): MemoryV2Scope[] {
  const scopes: MemoryV2Scope[] = [{ type: 'user', key: 'default' }];
  const projectPath = normalizeProjectPath(params.projectPath);
  if (params.mainAgent) scopes.push({ type: 'main_agent', key: 'main' });
  if (params.ownerModule) scopes.push({ type: 'module', key: params.ownerModule });
  if (projectPath) scopes.push({ type: 'project', key: projectScopeKey(projectPath) });
  if (params.sessionId) scopes.push({ type: 'session', key: params.sessionId });
  const seen = new Set<string>();
  return scopes.filter((scope) => {
    const key = `${scope.type}:${scope.key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function captureExplicitMemoryV2FromUserInput(params: {
  sessionId: string;
  projectPath?: string;
  messageId?: string;
  userInput: string;
}): MemoryV2Entry | null {
  if (!hasExplicitMemoryIntent(params.userInput)) return null;

  const session = getSession(params.sessionId);
  const projectPath = normalizeProjectPath(params.projectPath || session?.sdk_cwd || session?.working_directory || '');
  const mainAgent = isMainAgentSession(session);
  const workflowChat = isWorkflowChatSession(session);
  const wechatChat = isWeChatAssistantChatSession(session);
  const ownerModule = inferOwnerModule({ mainAgent, workflowChat, wechatChat, projectPath });
  const rawContent = stripExplicitPrefix(params.userInput);
  if (!rawContent || rawContent.length < 3) return null;

  const kind = inferKind(rawContent);
  const scope = inferScope({
    content: rawContent,
    kind,
    sessionId: params.sessionId,
    projectPath,
    mainAgent,
    ownerModule,
  });
  const redacted = processMemoryV2ResourceSecrets(rawContent, {
    scopeType: scope.scopeType,
    scopeKey: scope.scopeKey,
    ownerModule,
    sessionId: params.sessionId,
    messageId: params.messageId,
    projectPath,
    sourceType: 'user_explicit',
    sourceId: params.messageId,
  });

  const input: MemoryV2Input = {
    kind,
    scopeType: scope.scopeType,
    scopeKey: scope.scopeKey,
    ownerModule,
    status: 'active',
    title: titleFromContent(redacted.text, kind),
    body: redacted.text,
    summary: compact(redacted.text, 240),
    tags: inferTags(rawContent, kind),
    sourceType: 'user_explicit',
    sourceId: params.messageId,
    sessionId: params.sessionId,
    messageId: params.messageId,
    projectPath,
    sensitivity: redacted.sensitivity,
    secretRef: redacted.secretRefs[0],
    confidence: 1,
    importance: redacted.sensitivity !== 'normal' ? 5 : kind === 'task' ? 4 : 3,
    evidence: redacted.secretRefs.length > 0
      ? `用户提供了敏感值，已自动加密保存到 Vault：${redacted.secretRefs.join(', ')}`
      : redacted.sensitivity === 'secret_ref_required'
        ? '用户提到需要敏感资源，但没有提供真实值；执行相关任务时需要自动追问一次。'
        : params.userInput,
    metadata: {
      capture: 'explicit',
      projectName: projectPath ? path.basename(projectPath) : '',
      secretRefs: redacted.secretRefs,
    },
  };
  return createMemoryV2Entry(input);
}

function splitKeywords(prompt: string): string[] {
  const en = prompt.toLowerCase().split(/[^a-z0-9_]+/g).filter((item) => item.length >= 3);
  const zh = prompt.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return Array.from(new Set([...en, ...zh])).slice(0, 40);
}

function scoreEntry(entry: MemoryV2Entry, keywords: string[]): number {
  let score = entry.importance * 20 + Math.min(entry.hit_count, 10) * 2;
  if (entry.kind === 'resource') score += 8;
  if (entry.kind === 'task') score += 6;
  const haystack = `${entry.title} ${entry.body} ${entry.summary} ${entry.tags}`.toLowerCase();
  for (const keyword of keywords) {
    if (haystack.includes(keyword.toLowerCase())) score += keyword.length >= 4 ? 12 : 6;
  }
  const updated = Date.parse(entry.updated_at.replace(' ', 'T'));
  if (Number.isFinite(updated)) {
    const days = Math.floor((Date.now() - updated) / 86_400_000);
    score += Math.max(0, 14 - Math.min(days, 14));
  }
  return score;
}

function formatEntry(entry: MemoryV2Entry): string {
  const tags = parseMemoryV2Tags(entry.tags);
  const scope = `${entry.scope_type}:${entry.scope_key}`;
  const sensitivity = entry.sensitivity === 'normal'
    ? ''
    : entry.sensitivity === 'secret_ref_required'
      ? '；敏感值未保存，使用前需要 Vault 引用或向用户确认'
      : '；敏感资源，只能在相关任务中谨慎使用';
  const secretRef = entry.secret_ref ? `；secret_ref=${entry.secret_ref}` : '';
  const tagText = tags.length ? `；tags=${tags.join(',')}` : '';
  return `- ${entry.title}（scope=${scope}${tagText}${sensitivity}${secretRef}）\n  ${entry.body}`;
}

function formatMemoryV2Context(entries: MemoryV2Entry[], scopes: MemoryV2Scope[]): string {
  if (entries.length === 0) return '';
  const byKind = new Map<MemoryV2Kind, MemoryV2Entry[]>();
  for (const entry of entries) {
    const list = byKind.get(entry.kind) || [];
    list.push(entry);
    byKind.set(entry.kind, list);
  }
  const labels: Array<[MemoryV2Kind, string]> = [
    ['task', '任务账：背景、目标、状态、决策、下一步'],
    ['people', '人/角色账：用户、参与方、沟通偏好、责任边界'],
    ['resource', '资源账：账号、登录态、服务器、文件、权限、关键参数'],
    ['capability', '能力账：工具、MCP、Skill、Agent、能力缺口'],
    ['reflection', '复盘账：经验、教训、下次改进'],
  ];
  const lines = [
    '<lumos_action_memory_v2>',
    '这些是 Lumos Memory v2 的行动记忆。它们用于把事情做好，不是聊天记录。',
    `当前可用作用域：${scopes.map((scope) => `${scope.type}:${scope.key}`).join(' / ')}`,
    '使用规则：当前用户指令优先；只在相关时使用；不得泄露 secret_ref 或猜测敏感值；资源缺失时向用户说明需要什么。',
  ];
  for (const [kind, label] of labels) {
    const list = byKind.get(kind);
    if (!list?.length) continue;
    lines.push('', label);
    for (const entry of list) lines.push(formatEntry(entry));
  }
  lines.push('</lumos_action_memory_v2>');
  return lines.join('\n');
}

export function buildMemoryV2PackForPrompt(params: {
  sessionId: string;
  projectPath?: string;
  prompt: string;
  maxItems?: number;
  trackUsage?: boolean;
}): MemoryV2Pack {
  const session = getSession(params.sessionId);
  const projectPath = normalizeProjectPath(params.projectPath || session?.sdk_cwd || session?.working_directory || '');
  const mainAgent = isMainAgentSession(session);
  const workflowChat = isWorkflowChatSession(session);
  const wechatChat = isWeChatAssistantChatSession(session);
  const ownerModule = inferOwnerModule({ mainAgent, workflowChat, wechatChat, projectPath });
  const scopes = buildMemoryV2Scopes({
    sessionId: params.sessionId,
    projectPath,
    mainAgent,
    ownerModule,
  });
  const keywords = splitKeywords(params.prompt);
  const candidates = listMemoryV2ForScopes({ scopes, limit: 120 })
    .map((entry) => ({ entry, score: scoreEntry(entry, keywords) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(params.maxItems ?? 12, 24)))
    .map((item) => item.entry);
  const text = formatMemoryV2Context(candidates, scopes);
  if (params.trackUsage !== false && candidates.length > 0) {
    touchMemoryV2Usage(candidates.map((entry) => entry.id), {
      sessionId: params.sessionId,
      scopeKey: scopes.map((scope) => `${scope.type}:${scope.key}`).join('|'),
      promptPreview: params.prompt.slice(0, 180),
    });
  }
  return { text, entries: candidates, scopes };
}
