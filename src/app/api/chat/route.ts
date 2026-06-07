import { NextRequest } from 'next/server';
import { streamClaude } from '@/lib/claude-client';
import { validateSession } from '@/lib/auth/session';
import {
  buildCapabilityPlan,
  buildDbServerHints,
  buildAskModeAllowance,
  type ConnectorContext,
} from '@/lib/agent-capabilities';
import { addMessage, getMessages, getSession, updateSessionTitle, updateSdkSessionId, updateSessionModel, updateSessionResolvedModel, updateSessionProvider, updateSessionProviderId, updateSessionBrowserContext, updateSessionKnowledgeOptions, getSetting, acquireSessionLock, releaseSessionLock, setSessionRuntimeStatus, listBrowserProviderConfigs } from '@/lib/db';
import { resolveEnabledMcpServers } from '@/lib/mcp-resolver';
import type { SendMessageRequest, SSEEvent, TokenUsage, MessageContentBlock, FileAttachment, MCPServerConfig, ClaudeStreamOptions, KnowledgeOverrides } from '@/types';
import {
  isImageFile,
  parseMessageContent,
} from '@/types';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadToken } from '@/lib/feishu-auth';
import { fetchFeishuDocumentContext, parseFeishuReferenceMarkdown } from '@/lib/feishu/doc-content';
import { captureExplicitMemoryV2FromUserInput } from '@/lib/memory-v2/runtime';
import type { MemoryV2Entry } from '@/lib/memory-v2/types';
import { isMainAgentSession, stripMainAgentSessionMarker } from '@/lib/chat/session-entry';
import { getPreferredChatProviderId, shouldPersistChatProviderBinding } from '@/lib/chat/provider-selection';
import { isWorkflowChatSession } from '@/lib/chat/workflow-session';
import { isWeChatAssistantChatSession } from '@/lib/chat/wechat-assistant-session';
import { isEcommerceAssistantChatSession } from '@/lib/chat/ecommerce-assistant-session';
import { ProviderResolutionError, resolveProviderForCapability } from '@/lib/provider-resolver';
import {
  isBrowserAutomationRequest,
  prefersVisibleBrowserAction,
} from '@/lib/browser-provider/chat-intent';
import { isExplicitLumosBugIssueRequest } from '@/lib/lumos-issue-reporter/intent';

import { feishuSendLocalFiles, feishuSendMail, type FeishuMailDraft, syncMessageToFeishu, syncSessionTitleToFeishu } from '@/lib/bridge/sync-helper';
import { extractAssistantArtifactPaths } from '@/lib/bridge/file-artifact-extractor';

const CHROME_BRIDGE_URL_HEADER = 'x-lumos-browser-bridge-url';
const CHROME_BRIDGE_TOKEN_HEADER = 'x-lumos-browser-bridge-token';
const CHROME_BRIDGE_CONTEXT_HEADER = 'x-lumos-browser-context-id';
const FILE_DIRECTIVE_PREFIX = 'FEISHU_SEND_FILE::';
const MAIL_DIRECTIVE_PREFIX = 'FEISHU_SEND_MAIL::';
const MAX_FEISHU_CONTEXT_DOCS = 2;
const FEISHU_CONTEXT_MAX_CHARS = 3500;
// FEISHU/DEEPSEARCH/BROWSER 系统提示常量已迁至能力注册中心
// （src/lib/agent-capabilities/hints.ts），由对应连接器持有。
const BROWSER_REQUEST_DISALLOWED_TOOLS = [
  'Bash',
  'Task',
  'TaskOutput',
  'WebFetch',
  'WebSearch',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'LS',
  'NotebookEdit',
  'TodoWrite',
  'ExitPlanMode',
];

const MAIN_AGENT_PRIMARY_SESSION_HINT = `This conversation is the primary Main Agent space, not a project-specific thread.
Do not imply that a specific project workspace is active unless this session has an explicit working directory or the user explicitly selected one in this conversation.
If no project is currently selected, say that clearly and stay general.`;

const LUMOS_BUG_ISSUE_REQUEST_HINT = `
The user's current message explicitly asks to submit/report a Lumos bug.
You must use \`mcp__lumos-issue-reporter__report_lumos_bug\` for this request, unless a required field is truly impossible to infer.
If the user used direct wording such as "提 bug", "提交 bug", "提 issue", or "报到 GitHub", treat that as submission confirmation and set \`confirmed_by_user=true\`.
Build an issue that is useful for AI code repair: include the visible product area, reproduction steps, actual behavior, expected behavior, source message/link, suspected modules when grounded, and acceptance checks.
Do not answer with only a suggestion to report the bug.
Do not say the bug was submitted unless the tool returns \`success: true\` and an \`issueUrl\`.
If the tool fails, report the exact tool error and the next setup step.
`.trim();

// Ask 模式工具许可已迁至能力注册中心 buildAskModeAllowance（R4 第三通道）。
// 旧实现只给知识库/管家开口子、漏微信——同一非对称白名单 bug 的第三处。

function pickNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function sanitizeKnowledgeOverrides(raw: unknown): KnowledgeOverrides | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const out: KnowledgeOverrides = {};
  if (src.retrievalMode === 'reference' || src.retrievalMode === 'enhanced') {
    out.retrievalMode = src.retrievalMode;
  }
  if (typeof src.rewriteEnabled === 'boolean') {
    out.rewriteEnabled = src.rewriteEnabled;
  }
  if (typeof src.topK === 'number' && Number.isFinite(src.topK) && src.topK > 0) {
    out.topK = Math.max(1, Math.min(10, Math.floor(src.topK)));
  }
  if (typeof src.candidatePool === 'number' && Number.isFinite(src.candidatePool) && src.candidatePool > 0) {
    out.candidatePool = Math.max(16, Math.min(120, Math.floor(src.candidatePool)));
  }
  return Object.keys(out).length ? out : undefined;
}

function readChromeBridgeEnvFromRequest(request: NextRequest): { url?: string; token?: string; browserContextId?: string } {
  const url = pickNonEmpty(request.headers.get(CHROME_BRIDGE_URL_HEADER) || undefined);
  const token = pickNonEmpty(request.headers.get(CHROME_BRIDGE_TOKEN_HEADER) || undefined);
  const browserContextId = pickNonEmpty(request.headers.get(CHROME_BRIDGE_CONTEXT_HEADER) || undefined);
  return { url, token, browserContextId };
}

function normalizeBrowserMatchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function findMentionedBrowserContext(userInput: string): {
  contextId: string;
  displayName: string;
  providerType: string;
} | null {
  const normalizedInput = normalizeBrowserMatchText(userInput);
  if (!normalizedInput) {
    return null;
  }

  const matches: Array<{ contextId: string; displayName: string; providerType: string }> = [];
  for (const config of listBrowserProviderConfigs()) {
    if (config.enabled !== 1) {
      continue;
    }
    const candidates = [
      config.display_name,
      config.profile_name,
      config.profile_id,
      ...(Array.isArray(config.aliases) ? config.aliases : []),
    ]
      .map((candidate) => normalizeBrowserMatchText(candidate || ''))
      .filter((candidate) => candidate.length >= 2);

    if (candidates.some((candidate) => normalizedInput.includes(candidate))) {
      matches.push({
        contextId: config.context_id,
        displayName: config.profile_name || config.display_name,
        providerType: config.provider_type,
      });
    }
  }

  if (matches.length !== 1) {
    return null;
  }
  return matches[0];
}

// hasFeishuMcp / hasDeepSearchMcp 已由能力注册中心 buildDbServerHints 取代。
// onlyBrowserMcpServers 保留：用户自装 MCP 不在注册表，浏览器意图下做硬过滤兜底。
function onlyBrowserMcpServers(
  servers: Record<string, MCPServerConfig> | undefined,
): Record<string, MCPServerConfig> | undefined {
  if (!servers) return undefined;
  const result: Record<string, MCPServerConfig> = {};
  for (const name of ['chrome-devtools', 'chrome_devtools']) {
    if (servers[name]) {
      result[name] = servers[name];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isEmbeddedBrowserContext(contextId?: string): boolean {
  return !contextId || contextId.trim() === '' || contextId.trim() === 'embedded:default';
}

function resolveChatBrowserContextId(params: {
  matchedContextId?: string;
  requestHeaderContextId?: string;
  sessionContextId?: string;
}): string {
  const matchedContextId = pickNonEmpty(params.matchedContextId);
  if (matchedContextId) return matchedContextId;

  const headerContextId = pickNonEmpty(params.requestHeaderContextId);
  if (headerContextId && !isEmbeddedBrowserContext(headerContextId)) {
    return headerContextId;
  }

  const sessionContextId = pickNonEmpty(params.sessionContextId);
  if (sessionContextId && !isEmbeddedBrowserContext(sessionContextId)) {
    return sessionContextId;
  }

  return pickNonEmpty(headerContextId, sessionContextId, 'embedded:default');
}

function toFeishuDisplayText(rawContent: string): string {
  const blocks = parseMessageContent(rawContent);
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text.trim()) {
      parts.push(block.text.trim());
    }
  }
  const text = parts.join('\n\n').trim();
  return text || rawContent;
}

function extractFileDirectives(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const directives: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (trimmed.startsWith(FILE_DIRECTIVE_PREFIX)) {
      const filePath = trimmed.slice(FILE_DIRECTIVE_PREFIX.length).trim();
      if (filePath) directives.push(filePath);
    }
  }
  return directives;
}

function normalizeMailDraft(raw: unknown): FeishuMailDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const draft = raw as FeishuMailDraft;
  if (draft.attachments && !Array.isArray(draft.attachments)) {
    draft.attachments = [draft.attachments as unknown as string];
  }
  return draft;
}

function extractMailDirectives(text: string): FeishuMailDraft[] {
  const lines = text.split(/\r?\n/);
  const directives: FeishuMailDraft[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (trimmed.startsWith(MAIL_DIRECTIVE_PREFIX)) {
      const raw = trimmed.slice(MAIL_DIRECTIVE_PREFIX.length).trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const draft = normalizeMailDraft(parsed);
        if (draft) directives.push(draft);
      } catch {
        // ignore invalid directive
      }
    }
  }
  return directives;
}

function stripFileDirectives(text: string): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      output.push(line);
      continue;
    }
    if (!inCodeBlock && trimmed.startsWith(FILE_DIRECTIVE_PREFIX)) {
      continue;
    }
    output.push(line);
  }

  return output.join('\n').trim();
}

function stripMailDirectives(text: string): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      output.push(line);
      continue;
    }
    if (!inCodeBlock && trimmed.startsWith(MAIL_DIRECTIVE_PREFIX)) {
      continue;
    }
    output.push(line);
  }

  return output.join('\n').trim();
}

function stripFeishuDirectives(text: string): string {
  return stripMailDirectives(stripFileDirectives(text));
}


/**
 * Emit SSE comment frames at a regular interval so long-running tool calls
 * (e.g. 15-minute image generation) don't let the upstream stream idle out —
 * keeps the TCP connection / any intermediate proxy from giving up even when
 * no real SSE events flow. Client-side idle timeout is a separate defense.
 */
function withSseKeepAlive(
  stream: ReadableStream<string>,
  intervalMs = 10_000,
): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      let closed = false
      const tick = setInterval(() => {
        if (closed) return
        try { controller.enqueue(': keep-alive\n\n') } catch { closed = true }
      }, intervalMs)

      const reader = stream.getReader()
      ;(async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        } finally {
          closed = true
          clearInterval(tick)
          try { reader.releaseLock() } catch { /* already released */ }
        }
      })()
    },
  })
}

function prependActionMemoryEvent(
  stream: ReadableStream<string>,
  memory: MemoryV2Entry,
): ReadableStream<string> {
  const memoryEvent = `data: ${JSON.stringify({
    type: 'memory_v2_captured',
    data: JSON.stringify({
      id: memory.id,
      kind: memory.kind,
      scopeType: memory.scope_type,
      scopeKey: memory.scope_key,
      title: memory.title,
      sensitivity: memory.sensitivity,
      action: memory.created_at === memory.updated_at ? 'created' : 'updated',
    }),
  })}\n\n`;

  return new ReadableStream({
    async start(controller) {
      controller.enqueue(memoryEvent);
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function parseMessageSource(content: string): string | undefined {
  let text = content;
  while (true) {
    const match = text.match(/^<!--(.*?)-->\s*/);
    if (!match) break;
    const payload = match[1] || '';
    if (payload.startsWith('source:')) {
      return payload.slice('source:'.length).trim();
    }
    text = text.slice(match[0].length);
  }
  return undefined;
}

function isLatestUserMessageFromFeishu(sessionId: string): boolean {
  const { messages } = getMessages(sessionId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    return parseMessageSource(message.content) === 'feishu';
  }
  return false;
}

function decodeBase64ToUtf8(base64: string): string {
  try {
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

async function buildFeishuOnDemandContext(
  userPrompt: string,
  files?: FileAttachment[],
): Promise<string> {
  if (!files || files.length === 0) return '';

  const references: Array<{ token: string; type: string; title: string; url: string }> = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (isImageFile(file.type)) continue;
    if (!file.data) continue;
    if (!file.type.startsWith('text/') && !file.type.includes('markdown') && file.type !== 'application/json') {
      continue;
    }

    const content = decodeBase64ToUtf8(file.data);
    if (!content) continue;

    const ref = parseFeishuReferenceMarkdown(content);
    if (!ref) continue;

    const key = `${ref.type}:${ref.token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(ref);
  }

  if (references.length === 0) return '';

  const auth = loadToken();
  if (!auth || Date.now() > auth.expiresAt) {
    return '';
  }

  const sections: string[] = [];
  for (const ref of references.slice(0, MAX_FEISHU_CONTEXT_DOCS)) {
    try {
      const context = await fetchFeishuDocumentContext({
        userAccessToken: auth.userAccessToken,
        token: ref.token,
        type: ref.type,
        query: userPrompt,
        maxChars: FEISHU_CONTEXT_MAX_CHARS,
      });
      if (!context.excerpt.trim()) continue;
      sections.push([
        `Title: ${ref.title}`,
        `Source: ${ref.url}`,
        context.truncated ? '(excerpt, query-focused)' : '(full excerpt)',
        '',
        context.excerpt,
      ].join('\n'));
    } catch (error) {
      console.warn('[chat API] Failed to resolve Feishu reference context:', ref.token, error);
    }
  }

  if (sections.length === 0) return '';

  return [
    '<feishu_reference_context>',
    'The following content was fetched on-demand from attached Feishu references for the current query.',
    '',
    sections.join('\n\n---\n\n'),
    '',
    '</feishu_reference_context>',
  ].join('\n');
}

async function syncAssistantContentToFeishu(
  sessionId: string,
  rawContent: string,
): Promise<void> {
  const displayText = toFeishuDisplayText(rawContent);
  const fileDirectives = extractFileDirectives(displayText);
  const mailDirectives = extractMailDirectives(displayText);
  const cleanText = stripFeishuDirectives(displayText);
  const artifactPaths = extractAssistantArtifactPaths(rawContent);
  const shouldAutoSendMedia = isLatestUserMessageFromFeishu(sessionId);
  const autoMediaPaths = shouldAutoSendMedia ? artifactPaths.mediaPaths : [];
  const mediaPathsToSend = Array.from(new Set([...fileDirectives, ...autoMediaPaths]));

  if (cleanText) {
    await syncMessageToFeishu(sessionId, 'assistant', cleanText);
  }

  if (mediaPathsToSend.length > 0) {
    const sendResult = await feishuSendLocalFiles({
      sessionId,
      filePaths: mediaPathsToSend,
    });
    if (sendResult.failed.length > 0) {
      console.error('[Sync] Assistant media auto-send failed:', sendResult.failed.join(', '));
    }
  }

  if (mailDirectives.length > 0) {
    for (const draft of mailDirectives) {
      const result = await feishuSendMail({ sessionId, draft });
      if (!result.ok) {
        console.error('[Sync] Assistant mail directive send failed:', result.error);
      }
    }
  }
}


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let activeSessionId: string | undefined;
  let activeLockId: string | undefined;

  try {
    const body: SendMessageRequest & {
      files?: FileAttachment[];
      toolTimeout?: number;
      provider_id?: string;
      systemPromptAppend?: string;
    } = await request.json();
    const {
      session_id,
      content,
      model,
      mode,
      files,
      toolTimeout,
      provider_id,
      systemPromptAppend,
      knowledge_enabled,
      knowledge_tag_ids,
      knowledge_overrides,
    } = body;
    const knowledgeEnabledForRequest = knowledge_enabled === true;
    const selectedKnowledgeTagIds = Array.isArray(knowledge_tag_ids)
      ? knowledge_tag_ids.map((tagId) => String(tagId).trim()).filter(Boolean)
      : [];
    const sanitizedKnowledgeOverrides = sanitizeKnowledgeOverrides(knowledge_overrides);

    console.log('[chat API] content length:', content.length, 'first 200 chars:', content.slice(0, 200));
    console.log('[chat API] systemPromptAppend:', systemPromptAppend ? `${systemPromptAppend.length} chars` : 'none');
    console.log('[chat API] knowledge:', {
      enabled: knowledgeEnabledForRequest,
      tagCount: selectedKnowledgeTagIds.length,
      overrides: sanitizedKnowledgeOverrides,
    });

    if (!session_id || !content) {
      return new Response(JSON.stringify({ error: 'session_id and content are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = getSession(session_id);
    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Extract current user ID from session cookie for image quota tracking
    const lumosToken = request.cookies.get('lumos_session')?.value;
    const lumosUserId = lumosToken ? validateSession(lumosToken)?.id : undefined;

    // Acquire exclusive lock for this session to prevent concurrent requests
    const lockId = crypto.randomBytes(8).toString('hex');
    const lockAcquired = acquireSessionLock(session_id, lockId, `chat-${process.pid}`, 600);
    if (!lockAcquired) {
      return new Response(
        JSON.stringify({ error: 'Session is busy processing another request', code: 'SESSION_BUSY' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }
    activeSessionId = session_id;
    activeLockId = lockId;
    setSessionRuntimeStatus(session_id, 'running');

    let capturedActionMemory: MemoryV2Entry | null = null;

    if (typeof knowledge_enabled === 'boolean') {
      updateSessionKnowledgeOptions(session_id, {
        enabled: knowledgeEnabledForRequest,
        tagIds: selectedKnowledgeTagIds,
        overrides: sanitizedKnowledgeOverrides,
      });
    }

    const matchedBrowserContext = findMentionedBrowserContext(content);
    const sessionBrowserContextId = matchedBrowserContext?.contextId || session.browser_context_id || 'embedded:default';
    if (matchedBrowserContext && matchedBrowserContext.contextId !== (session.browser_context_id || 'embedded:default')) {
      updateSessionBrowserContext(session_id, matchedBrowserContext.contextId);
    }
    const browserAutomationIntent = isBrowserAutomationRequest({
      userInput: content,
      matchedBrowserContext: Boolean(matchedBrowserContext),
      selectedBrowserContextId: sessionBrowserContextId,
    });
    const visibleBrowserIntent = prefersVisibleBrowserAction({
      userInput: content,
      matchedBrowserContext: Boolean(matchedBrowserContext),
      selectedBrowserContextId: sessionBrowserContextId,
    });

    // Save user message — persist file metadata so attachments survive page reload
    let savedContent = content;
    let fileMeta: Array<{ id: string; name: string; type: string; size: number; filePath: string }> | undefined;
    if (files && files.length > 0) {
      fileMeta = files.map((f) => {
        // Use original file path if available (from file tree), otherwise save to uploads
        if (f.filePath) {
          // File from file tree - use original path directly
          return { id: f.id, name: f.name, type: f.type, size: f.size, filePath: f.filePath };
        } else {
          // File uploaded by user - save to .lumos-uploads
          const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
          const workDir = session.working_directory || dataDir;
          const uploadDir = path.join(workDir, '.lumos-uploads');
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          const safeName = path.basename(f.name).replace(/[^a-zA-Z0-9._-]/g, '_');
          const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`);
          const buffer = Buffer.from(f.data, 'base64');
          fs.writeFileSync(filePath, buffer);
          return { id: f.id, name: f.name, type: f.type, size: buffer.length, filePath };
        }
      });
      savedContent = `<!--files:${JSON.stringify(fileMeta)}-->${content}`;
    }
    const userMessageId = addMessage(session_id, 'user', savedContent).id;

    try {
      capturedActionMemory = captureExplicitMemoryV2FromUserInput({
        sessionId: session_id,
        projectPath: session.sdk_cwd || session.working_directory || undefined,
        messageId: userMessageId,
        userInput: content,
      });
      if (capturedActionMemory) {
        console.log('[memory-v2] captured action memory:', {
          id: capturedActionMemory.id,
          kind: capturedActionMemory.kind,
          scope: `${capturedActionMemory.scope_type}:${capturedActionMemory.scope_key}`,
          sensitivity: capturedActionMemory.sensitivity,
        });
      }
    } catch (error) {
      console.warn('[memory-v2] Failed to capture action memory from user input:', error);
    }

    syncMessageToFeishu(session_id, 'user', content).catch(err =>
      console.error('[Sync] User message sync failed:', err)
    );

    // Auto-generate title from first message if still default
    if (session.title === 'New Chat') {
      const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      updateSessionTitle(session_id, title);
      // Best-effort: sync auto-title to Feishu group name
      syncSessionTitleToFeishu(session_id, title).catch(err =>
        console.error('[Sync] Failed to update Feishu chat title:', err),
      );
    }

    // Resolve provider: an explicit picker choice on this request overrides the
    // older session binding. This keeps the backend aligned with the chat UI
    // even if the "switch provider" PATCH and the send-message POST race.
    const requestProviderId = provider_id?.trim() || '';
    const sessionProviderId = session.provider_id?.trim() || '';
    let resolvedProvider: import('@/types').ApiProvider | undefined;
    try {
      resolvedProvider = resolveProviderForCapability({
        moduleKey: 'chat',
        capability: 'agent-chat',
        preferredProviderId: getPreferredChatProviderId({
          requestProviderId,
          sessionProviderId,
        }),
      });
    } catch (error) {
      if (error instanceof ProviderResolutionError) {
        const status = sessionProviderId ? 409 : 400;
        return new Response(
          JSON.stringify({ error: error.message }),
          { status, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw error;
    }

    if (!resolvedProvider) {
      return new Response(
        JSON.stringify({ error: '未配置可用的主聊天服务商，请先到设置中选择一个支持 Agent Chat 的 provider。' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const effectiveProviderId = resolvedProvider.id;
    const providerName = resolvedProvider.name;
    if (providerName !== (session.provider_name || '')) {
      updateSessionProvider(session_id, providerName);
    }
    if (shouldPersistChatProviderBinding({
      requestProviderId,
      sessionProviderId,
      resolvedProviderId: effectiveProviderId,
    })) {
      updateSessionProviderId(session_id, effectiveProviderId);
    }

    // Model fallback: explicit request > session memory > provider's effective
    // default (user override beats admin-synced value, see
    // getProviderEffectiveDefaultModel) > legacy global default_model setting.
    const { getProviderEffectiveDefaultModel } = await import('@/lib/claude/provider-env');
    const effectiveModel = model
      || session.requested_model
      || session.model
      || getProviderEffectiveDefaultModel(resolvedProvider)
      || getSetting('default_model')
      || undefined;

    // Persist model to the session so usage stats can group by model+provider.
    // Cheap single-row UPDATE; only writes when the resolved value drifts.
    if (effectiveModel && effectiveModel !== (session.requested_model || session.model)) {
      updateSessionModel(session_id, effectiveModel);
    }

    const sessionSystemPrompt = stripMainAgentSessionMarker(session.system_prompt || '');

    // Determine permission mode from chat mode: code → acceptEdits, plan → plan, ask → default (no tools)
    const isPrimaryMainAgentSession = isMainAgentSession(session);
    const effectiveMode = mode || session.mode || 'code';
    let permissionMode: string;
    let systemPromptOverride: string | undefined;
    switch (effectiveMode) {
      case 'plan':
        permissionMode = 'plan';
        break;
      case 'ask':
        permissionMode = 'default';
        // 工具许可句移到 capabilityPlan 之后由 buildAskModeAllowance 追加
        // （R4 第三通道：与 MCP 注入/Skills 清单同源，杜绝微信再被漏掉）。
        systemPromptOverride = `${sessionSystemPrompt}${sessionSystemPrompt ? '\n\n' : ''}You are in Ask mode. Answer questions and provide information only. Do not read or write files, do not execute commands. Only respond with text.`;
        break;
      default: // 'code'
        permissionMode = 'acceptEdits';
        break;
    }

    const abortController = new AbortController();

    // Handle client disconnect
    request.signal.addEventListener('abort', () => {
      abortController.abort();
    });

    // Convert file attachments to the format expected by streamClaude.
    // Include filePath from the already-saved files so claude-client can
    // reference the on-disk copies instead of writing them again.
    const fileAttachments: FileAttachment[] | undefined = files && files.length > 0
      ? files.map((f, i) => {
          const meta = fileMeta?.find((m: { id: string }) => m.id === f.id);
          return {
            id: f.id || `file-${Date.now()}-${i}`,
            name: f.name,
            type: f.type,
            size: f.size,
            data: f.data,
            filePath: meta?.filePath,
          };
        })
      : undefined;

    const hasLumosBugIssueIntent = isExplicitLumosBugIssueRequest(content);
    const feishuContext = await buildFeishuOnDemandContext(content, fileAttachments);
    const promptForModel = feishuContext ? `${content}\n\n${feishuContext}` : content;
    const neutralMainAgentWorkingDirectory = process.env.LUMOS_DATA_DIR
      || process.env.CLAUDE_GUI_DATA_DIR
      || path.join(os.homedir(), '.lumos');
    const resolvedSessionWorkingDirectory = session.sdk_cwd
      || session.working_directory
      || (isPrimaryMainAgentSession ? neutralMainAgentWorkingDirectory : undefined);

    console.time('[perf] MCP servers loading');
    const browserBridgeOverride = readChromeBridgeEnvFromRequest(request);
    const browserContextId = resolveChatBrowserContextId({
      matchedContextId: matchedBrowserContext?.contextId,
      requestHeaderContextId: browserBridgeOverride.browserContextId,
      sessionContextId: sessionBrowserContextId,
    });
    const isDedicatedWeChatAssistantSession = isWeChatAssistantChatSession(session);
    const selectedBrowserLabel = matchedBrowserContext
      ? `${matchedBrowserContext.displayName} (${matchedBrowserContext.contextId})`
      : browserContextId;
    // 能力注册中心是「本会话有什么能力」的唯一裁决处——route 不再散写
    // per-connector 门禁。真源：docs/agent-capability-registry.md
    const connectorContext: ConnectorContext = {
      sessionId: session_id,
      userId: lumosUserId,
      permissionMode: permissionMode as ConnectorContext['permissionMode'],
      browserAutomationIntent,
      visibleBrowserIntent,
      isPrimaryMainAgentSession,
      isDedicatedWeChatAssistantSession,
      isWorkflowChatSession: isWorkflowChatSession(session),
      isEcommerceAssistantChatSession: isEcommerceAssistantChatSession(session),
      knowledgeEnabledForRequest,
      selectedKnowledgeTagIds,
      knowledgeOverrides: sanitizedKnowledgeOverrides,
      selectedBrowserLabel,
    };
    const capabilityPlan = buildCapabilityPlan(connectorContext);
    let loadedMcpServers = resolveEnabledMcpServers({
      sessionWorkingDirectory: resolvedSessionWorkingDirectory,
      sessionId: session_id,
      browserBridgeOverride,
      browserContextId,
      skipNames: capabilityPlan.dbMcpSkipNames,
      browserBackground: !visibleBrowserIntent,
    });
    if (browserAutomationIntent) {
      // 兜底：用户自装 MCP 不在注册表，浏览器意图下硬过滤只留浏览器工具。
      loadedMcpServers = onlyBrowserMcpServers(loadedMcpServers);
    }
    console.timeEnd('[perf] MCP servers loading');

    // Append per-request system prompt (e.g. skill injection for image generation)
    let finalSystemPrompt = systemPromptOverride || sessionSystemPrompt || undefined;
    // R4 第三通道：Ask 模式工具许可由注册中心统一裁决（含微信只读工具），
    // 紧接 Ask 指令之后，与 MCP 注入/Skills 清单同源——杜绝微信再被漏。
    if (effectiveMode === 'ask') {
      finalSystemPrompt = (finalSystemPrompt || '') + buildAskModeAllowance(connectorContext);
    }
    if (systemPromptAppend) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + systemPromptAppend;
    }
    if (isPrimaryMainAgentSession) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + MAIN_AGENT_PRIMARY_SESSION_HINT;
    }
    if (hasLumosBugIssueIntent) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + LUMOS_BUG_ISSUE_REQUEST_HINT;
    }
    // 生图工具的广告已随工具同源,从 lumosImageConnector.buildHint 走下面 capabilityPlan.systemHintAppend。
    // (删掉了这里按 permissionMode 重复判断的 hint 门禁——与连接器 appliesTo 抄两份且已漂移。)
    // 连接器自身广告（phase 1，模式无关）：微信/知识库/管家等 in-process 连接器 hint。
    if (capabilityPlan.systemHintAppend) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + capabilityPlan.systemHintAppend;
    }
    // DB-server 相关广告（phase 2，解析后）：feishu/deepsearch/im-tools/chrome-devtools。
    // R2：恒附，不再被 permissionMode==='default' 吞掉。
    const presentDbServers = new Set(Object.keys(loadedMcpServers || {}));
    const dbServerHints = buildDbServerHints(connectorContext, presentDbServers);
    if (dbServerHints) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + dbServerHints;
    }
    // 通用发现提示：列出未被专属 hint 覆盖的已加载 MCP（多为用户自装）。
    // R2：移除 permissionMode==='default' 闸——这正是「Ask 模式 agent
    // 以为自己没有微信/任何工具」事故的直接修复点。
    if (loadedMcpServers) {
      const BUILTIN_HINTED_MCPS = new Set(['feishu', 'deepsearch', 'chrome-devtools', 'chrome_devtools']);
      const userMcpNames = Object.keys(loadedMcpServers).filter(n => !BUILTIN_HINTED_MCPS.has(n));
      if (userMcpNames.length > 0) {
        const list = userMcpNames.map(n => `- \`${n}\`: tools available as \`mcp__${n}__<tool_name>\``).join('\n');
        finalSystemPrompt = (finalSystemPrompt || '') + `\n\nYou have access to the following additional MCP servers. Use their tools when relevant:\n${list}`;
      }
    }

    // Ask 模式权威总钳（必须在所有能力提示之后，靠 recency 压过它们的
    // 祈使句）。R2 保留能力感知（上面照列，agent 知道有啥、能如实告诉
    // 用户），但本轮只准调许可内工具/受控动作——消解「只准用X」与发现/IM/
    // DeepSearch 提示「use their tools」的指令矛盾，避免 Ask 模式误触工具
    // /意外权限弹窗。非 Ask 模式不加，零回归。
    if (effectiveMode === 'ask') {
      finalSystemPrompt = (finalSystemPrompt || '')
        + '\n\n(Ask mode — authoritative: the capability and MCP descriptions above are only so you can accurately tell the user what Lumos can do. This turn you may ONLY call tools or controlled actions explicitly permitted in the Ask-mode allowance stated earlier. Do NOT invoke any other tool — no message sends, web/deepsearch runs, automations, browser control, or goofish/douyin/x tools. For Lumos bug reports, use the issue reporter only when the user explicitly asks to submit/report a bug, and only claim success after the tool returns an issue URL. If answering needs any other action or a non-permitted tool, explain what is possible and that it requires switching out of Ask mode; do not attempt the tool.)';
    }

    // Load recent conversation history from DB as fallback context.
    // This is used when SDK session resume is unavailable or fails,
    // so the model still has conversation context.
    const { messages: recentMsgs } = getMessages(session_id, { limit: 50 });
    // Exclude the user message we just saved (last in the list) — it's already the prompt
    const historyMsgs = recentMsgs.slice(0, -1).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: stripFeishuDirectives(m.content),
    }));

    // Stream Claude response, using SDK session ID for resume if available
    console.log('[chat API] streamClaude params:', {
      promptLength: promptForModel.length,
      promptFirst200: promptForModel.slice(0, 200),
      sdkSessionId: session.sdk_session_id || 'none',
      systemPromptLength: finalSystemPrompt?.length || 0,
      systemPromptFirst200: finalSystemPrompt?.slice(0, 200) || 'none',
      mcpServers: loadedMcpServers ? Object.keys(loadedMcpServers) : 'none',
    });

    // In-process MCP servers — 由能力注册中心统一裁决（见上方 capabilityPlan）。
    // 微信助手在此恒注入（不再被 permissionMode 闸），readOnly=非微信专属会话。
    const inProcessMcpServers: NonNullable<ClaudeStreamOptions['inProcessMcpServers']> =
      capabilityPlan.inProcessServers;

    const claudeStream = streamClaude({
      prompt: promptForModel,
      rawPrompt: content,
      sessionId: session_id,
      sdkSessionId: session.sdk_session_id || undefined,
      model: effectiveModel,
      systemPrompt: finalSystemPrompt,
      workingDirectory: resolvedSessionWorkingDirectory,
      mcpServers: loadedMcpServers,
      inProcessMcpServers: Object.keys(inProcessMcpServers).length > 0 ? inProcessMcpServers : undefined,
      inProcessVariantKeys: capabilityPlan.inProcessVariantKeys,
      abortController,
      permissionMode,
      files: fileAttachments,
      toolTimeoutSeconds: toolTimeout || 900,
      forceFreshSession: browserAutomationIntent,
      sdkBuiltinTools: browserAutomationIntent ? [] : undefined,
      disallowedTools: browserAutomationIntent ? BROWSER_REQUEST_DISALLOWED_TOOLS : undefined,
      provider: resolvedProvider,
      knowledgeOptions: {
        enabled: knowledgeEnabledForRequest,
        tagIds: selectedKnowledgeTagIds,
        overrides: sanitizedKnowledgeOverrides,
      },
      conversationHistory: historyMsgs,
      onRuntimeStatusChange: (status: string) => {
        try { setSessionRuntimeStatus(session_id, status); } catch { /* best effort */ }
      },
    });

    const stream = capturedActionMemory
      ? prependActionMemoryEvent(claudeStream, capturedActionMemory)
      : claudeStream;

    // Tee the stream: one for client, one for collecting the response
    const [streamForClient, streamForCollect] = stream.tee();

    // Save assistant message in background, with cleanup callback to release lock
    collectStreamResponse(streamForCollect, {
      sessionId: session_id,
      sourceUserMessageId: userMessageId,
      onComplete: () => {
        releaseSessionLock(session_id, lockId);
        setSessionRuntimeStatus(session_id, 'idle');
      },
    });

    return new Response(withSseKeepAlive(streamForClient), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    // Release lock and reset status on error (only if lock was acquired)
    if (activeSessionId && activeLockId) {
      try {
        releaseSessionLock(activeSessionId, activeLockId);
        setSessionRuntimeStatus(activeSessionId, 'idle', error instanceof Error ? error.message : 'Unknown error');
      } catch { /* best effort */ }
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function collectStreamResponse(
  stream: ReadableStream<string>,
  options: {
    sessionId: string;
    sourceUserMessageId?: string;
    onComplete?: () => void;
  },
) {
  const sessionId = options.sessionId;
  const streamStartTime = Date.now();
  const reader = stream.getReader();
  const contentBlocks: MessageContentBlock[] = [];
  let currentText = '';
  let tokenUsage: TokenUsage | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = value.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event: SSEEvent = JSON.parse(line.slice(6));
            if (event.type === 'permission_request' || event.type === 'tool_output') {
              // Skip permission_request and tool_output events - not saved as message content
            } else if (event.type === 'text') {
              currentText += event.data;
            } else if (event.type === 'tool_use_summary') {
              if (currentText.trim()) {
                contentBlocks.push({ type: 'text', text: currentText });
                currentText = '';
              }
              try {
                const summaryData = JSON.parse(event.data);
                const summary = typeof summaryData.summary === 'string' ? summaryData.summary.trim() : '';
                if (summary) {
                  contentBlocks.push({ type: 'reasoning', summary });
                }
              } catch {
                const summary = event.data.trim();
                if (summary) {
                  contentBlocks.push({ type: 'reasoning', summary });
                }
              }
            } else if (event.type === 'tool_use') {
              // Flush any accumulated text before the tool use block
              if (currentText.trim()) {
                contentBlocks.push({ type: 'text', text: currentText });
                currentText = '';
              }
              try {
                const toolData = JSON.parse(event.data);
                contentBlocks.push({
                  type: 'tool_use',
                  id: toolData.id,
                  name: toolData.name,
                  input: toolData.input,
                });
              } catch {
                // skip malformed tool_use data
              }
            } else if (event.type === 'tool_result') {
              try {
                const resultData = JSON.parse(event.data);
                contentBlocks.push({
                  type: 'tool_result',
                  tool_use_id: resultData.tool_use_id,
                  content: resultData.content,
                  is_error: resultData.is_error || false,
                });
              } catch {
                // skip malformed tool_result data
              }
            } else if (event.type === 'status') {
              // Capture SDK session_id and model from init event and persist them
              try {
                const statusData = JSON.parse(event.data);
                if (statusData.session_id) {
                  updateSdkSessionId(sessionId, statusData.session_id);
                }
                if (statusData.model) {
                  updateSessionResolvedModel(sessionId, statusData.model);
                }
              } catch {
                // skip malformed status data
              }
            } else if (event.type === 'result') {
              try {
                const resultData = JSON.parse(event.data);
                if (resultData.usage) {
                  tokenUsage = resultData.usage;
                }
                // Also capture session_id from result if we missed it from init
                if (resultData.session_id) {
                  updateSdkSessionId(sessionId, resultData.session_id);
                }
              } catch {
                // skip malformed result data
              }
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    }

    // Flush any remaining text
    if (currentText.trim()) {
      contentBlocks.push({ type: 'text', text: currentText });
    }

    if (contentBlocks.length > 0) {
      // If the message is text-only (no tool calls), store as plain text
      // for backward compatibility with existing message rendering.
      // If it contains tool calls, store as structured JSON.
      const hasStructuredBlocks = contentBlocks.some((b) => b.type !== 'text');

      const content = hasStructuredBlocks
        ? JSON.stringify(contentBlocks)
        : contentBlocks
            .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();

      if (content) {
        const storedContent = hasStructuredBlocks ? content : stripFeishuDirectives(content);
        if (storedContent) {
          addMessage(
            sessionId,
            'assistant',
            storedContent,
            tokenUsage ? JSON.stringify(tokenUsage) : null,
            Date.now() - streamStartTime,
          );
        }
        syncAssistantContentToFeishu(sessionId, content).catch(err =>
          console.error('[Sync] Assistant message sync failed:', err),
        );
      }
    }
  } catch {
    // Stream reading error - best effort save
    if (currentText.trim()) {
      contentBlocks.push({ type: 'text', text: currentText });
    }
    if (contentBlocks.length > 0) {
      const hasStructuredBlocks = contentBlocks.some((b) => b.type !== 'text');
      const content = hasStructuredBlocks
        ? JSON.stringify(contentBlocks)
        : contentBlocks
            .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();
      if (content) {
        const storedContent = hasStructuredBlocks ? content : stripFeishuDirectives(content);
        if (storedContent) {
          addMessage(sessionId, 'assistant', storedContent);
        }
        syncAssistantContentToFeishu(sessionId, content).catch(err =>
          console.error('[Sync] Assistant message sync failed:', err),
        );

      }
    }
  } finally {
    options.onComplete?.();
  }
}
