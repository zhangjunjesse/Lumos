import { NextRequest } from 'next/server';
import { streamClaude } from '@/lib/claude-client';
import { addMessage, getMessages, getSession, updateSessionTitle, updateSdkSessionId, updateSessionModel, updateSessionResolvedModel, updateSessionProvider, updateSessionProviderId, getSetting, getProvider, getDefaultProviderId, acquireSessionLock, releaseSessionLock, setSessionRuntimeStatus, getEnabledMcpServersAsConfig, getAllProviders } from '@/lib/db';
import {
  getMainAgentSessionTeamRuntimePrompt,
  getMainAgentSessionTeamRuntimeState,
  getMainAgentTeamConfigurationPrompt,
  upsertTeamPlanTask,
} from '@/lib/db/tasks';
import type { SendMessageRequest, SSEEvent, TokenUsage, MessageContentBlock, FileAttachment, MCPServerConfig } from '@/types';
import {
  createTeamRunSkeleton,
  isImageFile,
  parseMessageContent,
  parseTeamPlanBlock,
  TEAM_PLAN_BLOCK_KIND,
  TEAM_PLAN_TASK_KIND,
} from '@/types';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadToken } from '@/lib/feishu-auth';
import { getFeishuCredentials } from '@/lib/feishu-config';
import { fetchFeishuDocumentContext, parseFeishuReferenceMarkdown } from '@/lib/feishu/doc-content';
import { captureExplicitMemoryWithConflictCheck } from '@/lib/memory/runtime';
import { detectWeakMemorySignal, runMemoryIntelligenceForSession } from '@/lib/memory/intelligence';
import { linkMessageMemory } from '@/lib/db/message-memories';
import { isMainAgentSession, stripMainAgentSessionMarker } from '@/lib/chat/session-entry';
import { normalizeMainAgentConversationHistoryForTeamRuntime } from '@/lib/chat/team-runtime-history';

import { feishuSendLocalFiles, feishuSendMail, type FeishuMailDraft, syncMessageToFeishu, syncSessionTitleToFeishu } from '@/lib/bridge/sync-helper';
import { extractAssistantArtifactPaths } from '@/lib/bridge/file-artifact-extractor';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-image-preview';
const CHROME_MCP_NAMES = new Set(['chrome-devtools', 'chrome_devtools']);
const CHROME_BRIDGE_URL_HEADER = 'x-lumos-browser-bridge-url';
const CHROME_BRIDGE_TOKEN_HEADER = 'x-lumos-browser-bridge-token';
const FILE_DIRECTIVE_PREFIX = 'FEISHU_SEND_FILE::';
const MAIL_DIRECTIVE_PREFIX = 'FEISHU_SEND_MAIL::';
const MAX_FEISHU_CONTEXT_DOCS = 2;
const FEISHU_CONTEXT_MAX_CHARS = 3500;
const GEMINI_IMAGE_MCP_SYSTEM_HINT = `When the user asks to generate, draw, edit, restyle, or otherwise transform images, use the MCP tool \`generate_image\` from the \`gemini-image\` server.
Do not output fenced planning blocks like \`image-gen-request\` or \`batch-plan\` when this tool is available.
Tool argument guidance:
- \`prompt\` (required): write a clear English prompt. For editing tasks, describe only the requested changes.
- \`reference_images\` (optional): include local file paths of user-attached images or previously generated images when relevant.
- \`output_dir\` (optional): prefer the current workspace root. Avoid temporary directories like /tmp.
- \`aspect_ratio\` (optional): use values like 1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4 if requested.
Rules:
- For image requests, call \`generate_image\` before you claim success.
- If no successful \`tool_result\` with image paths is available, do not claim the image is generated.
- Do not claim anything was sent to Feishu unless the user explicitly asked to send to Feishu in this turn.
- If user explicitly asks to send generated files to Feishu, include \`FEISHU_SEND_FILE::<absolute_path>\` on a separate line for each file.
- MCP config in Lumos is managed internally (database + built-in resources). Never ask users to edit \`.kiro/settings/mcp.json\`, \`.claude.json\`, or external client configs.
- If tool result reports missing Gemini key, tell user to configure it in Lumos UI: Settings -> Providers -> \`gemini-image\` (API Key, optional Base URL/Model).
After successful tool execution, briefly summarize what was generated and include returned image paths.`;
const FEISHU_REPORT_MCP_SYSTEM_HINT = `When user asks for Feishu reports, weekly reports, daily reports, monthly summaries, or "汇报", prefer these MCP tools from server \`feishu\`:
- \`feishu_report_list\`: find candidate report tasks first.
- \`feishu_report_read\`: read the selected report task detail.
Rules:
- Do not claim report content before successful tool_result.
- These tools target Feishu report app APIs (\`report/v1\`), not generic docs search.
- If API reports missing scopes, tell user to enable app identity scopes: \`report:rule:readonly\` and \`report:task:readonly\`.
- If auth/token is missing, ask user to login Feishu in Lumos first.`;
const MAIN_AGENT_TEAM_MODE_SYSTEM_HINT = `You are Lumos Main Agent. Remain the only user-facing entry point in this chat.
Team Mode is session-scoped under the current Main Agent conversation, never a separate top-level agent.
When the user explicitly asks for multi-role collaboration, or the task is clearly complex enough to benefit from coordinated roles, do not start execution immediately. First propose a structured Team Mode plan and wait for user confirmation.
If Team Mode is not warranted, answer normally and keep the work in Main Agent mode.
When you propose Team Mode, include a fenced \`${TEAM_PLAN_BLOCK_KIND}\` block with valid JSON using this exact schema:
\`\`\`${TEAM_PLAN_BLOCK_KIND}
{
  "summary": "short why-this-team summary",
  "activationReason": "user_requested" | "main_agent_suggested",
  "userGoal": "the goal in user terms",
  "roles": [
    { "id": "main-agent", "name": "Main Agent", "kind": "main_agent", "responsibility": "user-facing owner" },
    { "id": "orchestrator", "name": "Team Orchestrator", "kind": "orchestrator", "responsibility": "coordinate execution" }
  ],
  "tasks": [
    {
      "id": "task-1",
      "title": "clear task title",
      "ownerRoleId": "orchestrator",
      "summary": "what this task covers",
      "dependsOn": [],
      "expectedOutput": "specific output"
    }
  ],
  "expectedOutcome": "what the full team should deliver",
  "risks": ["optional risk"],
  "confirmationPrompt": "short approval prompt"
}
\`\`\`
Rules for Team Mode proposals:
- Roles must stay within the MVP hierarchy: Main Agent -> Orchestrator -> Leads -> Workers.
- Include explicit dependencies and expected outputs for each task.
- Do not claim Team Run has started until the user confirms.
- Keep the user-facing explanation concise and decision-oriented.`;
const MAIN_AGENT_PRIMARY_SESSION_HINT = `This conversation is the primary Main Agent space, not a project-specific thread.
Do not imply that a specific project workspace is active unless this session has an explicit working directory or the user explicitly selected one in this conversation.
If no project is currently selected, say that clearly and stay general.`;

const TASK_MANAGEMENT_HINT = `# Task Management - CRITICAL

You have access to task-management MCP tools. For ANY complex implementation request, you MUST call createTask FIRST before attempting direct implementation.

**MANDATORY: Call createTask for:**
- System/feature implementation (e.g., "实现用户管理系统", "开发XX功能")
- Multi-file modifications
- Tasks requiring >2 minutes

**How to use:**
1. Recognize complex task → Call createTask tool immediately
2. Do NOT start implementation yourself
3. After createTask succeeds, inform user the task is delegated

**Available tools:**
- createTask(taskSummary, requirements, sessionId)
- listTasks(sessionId, status)
- getTaskDetail(taskId)
- cancelTask(taskId)

**Example:** User says "实现用户管理系统" → You MUST call createTask, NOT implement directly.`;

function pickNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function parseExtraEnv(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function resolveGeminiMcpEnv(
  existingEnv?: Record<string, string>,
  sessionWorkingDirectory?: string,
): Record<string, string> {
  const env = { ...(existingEnv || {}) };
  const geminiProvider = getAllProviders().find((p) => p.provider_type === 'gemini-image');
  const providerEnv = parseExtraEnv(geminiProvider?.extra_env);

  const providerApiKey = pickNonEmpty(geminiProvider?.api_key, providerEnv.GEMINI_API_KEY);
  const providerBaseUrl = pickNonEmpty(geminiProvider?.base_url, providerEnv.GEMINI_BASE_URL);
  const providerModel = pickNonEmpty(providerEnv.GEMINI_MODEL, providerEnv.GEMINI_IMAGE_MODEL);

  // Provider settings in Lumos UI are canonical and should override stale MCP env values.
  env.GEMINI_API_KEY = pickNonEmpty(
    providerApiKey,
    env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY,
  );
  env.GEMINI_BASE_URL = pickNonEmpty(
    providerBaseUrl,
    env.GEMINI_BASE_URL,
    process.env.GEMINI_BASE_URL,
    DEFAULT_GEMINI_BASE_URL,
  );
  env.GEMINI_MODEL = pickNonEmpty(
    providerModel,
    env.GEMINI_MODEL,
    process.env.GEMINI_MODEL,
    DEFAULT_GEMINI_MODEL,
  );
  env.GEMINI_OUTPUT_DIR = pickNonEmpty(
    env.GEMINI_OUTPUT_DIR,
    sessionWorkingDirectory,
    process.env.GEMINI_OUTPUT_DIR,
  );

  return env;
}

function readChromeBridgeEnvFromRequest(request: NextRequest): { url?: string; token?: string } {
  const url = pickNonEmpty(request.headers.get(CHROME_BRIDGE_URL_HEADER) || undefined);
  const token = pickNonEmpty(request.headers.get(CHROME_BRIDGE_TOKEN_HEADER) || undefined);
  return { url, token };
}

function readChromeBridgeEnvFromRuntimeFile(): { url?: string; token?: string } {
  try {
    const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
    const runtimePath = path.join(dataDir, 'runtime', 'browser-bridge.json');
    if (!fs.existsSync(runtimePath)) return {};

    const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as {
      url?: unknown;
      token?: unknown;
    };

    return {
      url: typeof parsed.url === 'string' ? parsed.url : undefined,
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
    };
  } catch {
    return {};
  }
}

function resolveChromeBridgeEnv(
  existingEnv?: Record<string, string>,
  bridgeFromRequest?: { url?: string; token?: string },
  bridgeFromRuntime?: { url?: string; token?: string },
): Record<string, string> {
  const env = { ...(existingEnv || {}) };
  env.LUMOS_BROWSER_BRIDGE_URL = pickNonEmpty(
    bridgeFromRequest?.url,
    process.env.LUMOS_BROWSER_BRIDGE_URL,
    bridgeFromRuntime?.url,
    env.LUMOS_BROWSER_BRIDGE_URL,
  );
  env.LUMOS_BROWSER_BRIDGE_TOKEN = pickNonEmpty(
    bridgeFromRequest?.token,
    process.env.LUMOS_BROWSER_BRIDGE_TOKEN,
    bridgeFromRuntime?.token,
    env.LUMOS_BROWSER_BRIDGE_TOKEN,
  );
  return env;
}

function hasGeminiImageMcp(
  servers: Record<string, MCPServerConfig> | undefined,
): boolean {
  if (!servers) return false;
  return Boolean(servers['gemini-image'] || servers['gemini_image']);
}

function hasFeishuMcp(
  servers: Record<string, MCPServerConfig> | undefined,
): boolean {
  if (!servers) return false;
  return Boolean(servers.feishu);
}

function isLegacyImageAgentPrompt(systemPromptAppend?: string): boolean {
  if (!systemPromptAppend) return false;
  const prompt = systemPromptAppend.toLowerCase();
  return prompt.includes('image-gen-request') || prompt.includes('batch-plan');
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

function extractAssistantTextContent(rawContent: string): string {
  const blocks = parseMessageContent(rawContent);
  return blocks
    .filter((block): block is Extract<MessageContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function persistTeamPlanFromAssistantContent(
  sessionId: string,
  rawContent: string,
  sourceMessageId?: string,
): void {
  const textContent = extractAssistantTextContent(rawContent);
  if (!textContent) return;

  const parsed = parseTeamPlanBlock(textContent);
  if (!parsed) return;

  upsertTeamPlanTask(sessionId, {
    kind: TEAM_PLAN_TASK_KIND,
    plan: parsed.plan,
    approvalStatus: 'pending',
    run: createTeamRunSkeleton(parsed.plan),
    sourceMessageId,
    approvedAt: null,
    rejectedAt: null,
    lastActionAt: null,
  });
}

function prependMemoryEvent(
  stream: ReadableStream<string>,
  memory: import('@/lib/db/memories').MemoryRecord,
  eventType: 'captured' | 'conflict',
  newContent?: string,
): ReadableStream<string> {
  const eventData = eventType === 'captured'
    ? {
        id: memory.id,
        scope: memory.scope,
        category: memory.category,
        content: memory.content,
        action: memory.created_at === memory.updated_at ? 'created' : 'updated',
      }
    : {
        conflictingMemory: {
          id: memory.id,
          scope: memory.scope,
          category: memory.category,
          content: memory.content,
        },
        newContent: newContent || '',
      };

  const memoryEvent = `data: ${JSON.stringify({
    type: eventType === 'captured' ? 'memory_captured' : 'memory_conflict',
    data: JSON.stringify(eventData),
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

/** Load MCP servers from database (builtin + user) */
function loadMcpServers(
  sessionWorkingDirectory?: string,
  bridgeFromRequest?: { url?: string; token?: string },
  bridgeFromRuntime?: { url?: string; token?: string },
): Record<string, MCPServerConfig> | undefined {
  // Load enabled MCP servers from database
  const mcpServers = getEnabledMcpServersAsConfig();
  const { appId: feishuAppId, appSecret: feishuAppSecret } = getFeishuCredentials();

  // Resolve [RUNTIME_PATH] placeholder in args
  // In production: process.resourcesPath/
  // In development: project_root/resources/
  let runtimePath: string;
  if (process.env.NODE_ENV === 'production' && typeof process.resourcesPath === 'string') {
    runtimePath = process.resourcesPath;
  } else {
    runtimePath = path.join(process.cwd(), 'resources');
  }

  const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
  const workspacePath = sessionWorkingDirectory || process.cwd();
  const legacyMcpPathPattern = /[/\\]feishu-mcp-server[/\\]mcp-servers[/\\]/g;
  const normalizedMcpPathSegment = `${path.sep}mcp-servers${path.sep}`;

  for (const [name, config] of Object.entries(mcpServers)) {
    if (config.args) {
      config.args = config.args.map(arg => {
        const normalizedArg = arg.replace(legacyMcpPathPattern, normalizedMcpPathSegment);
        return normalizedArg
          .replace('[RUNTIME_PATH]', runtimePath)
          .replace('[WORKSPACE_PATH]', workspacePath)
          .replace('[DATA_DIR]', dataDir)
          .replace(/^~\//, os.homedir() + '/');
      });
    }
    if (config.env) {
      const resolvedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(config.env)) {
        resolvedEnv[key] = value
          .replace('[RUNTIME_PATH]', runtimePath)
          .replace('[WORKSPACE_PATH]', workspacePath)
          .replace('[DATA_DIR]', dataDir)
          .replace(/^~\//, os.homedir() + '/');
      }
      config.env = resolvedEnv;
    }

    // Special handling for feishu MCP: inject environment variables
    if (name === 'feishu') {
      config.env = {
        ...config.env,
        FEISHU_APP_ID: feishuAppId,
        FEISHU_APP_SECRET: feishuAppSecret,
        FEISHU_TOKEN_PATH: path.join(dataDir, 'auth', 'feishu.json'),
      };
    }

    // Special handling for bilibili MCP: inject SESSDATA from env if not already set
    if (name === 'bilibili' && !config.env?.BILIBILI_SESSDATA) {
      config.env = {
        ...config.env,
        BILIBILI_SESSDATA: process.env.BILIBILI_SESSDATA || '',
      };
    }

    // Special handling for gemini-image MCP: allow provider-managed URL/KEY/model
    if (name === 'gemini-image' || name === 'gemini_image') {
      config.env = resolveGeminiMcpEnv(config.env, sessionWorkingDirectory);
      console.log('[chat API] gemini-image MCP resolved:', {
        command: config.command,
        args: config.args,
        hasApiKey: Boolean(config.env?.GEMINI_API_KEY),
        baseUrl: config.env?.GEMINI_BASE_URL || '',
        model: config.env?.GEMINI_MODEL || '',
        outputDir: config.env?.GEMINI_OUTPUT_DIR || '',
      });
    }

    if (CHROME_MCP_NAMES.has(name)) {
      config.env = resolveChromeBridgeEnv(config.env, bridgeFromRequest, bridgeFromRuntime);
      console.log('[chat API] chrome-devtools MCP bridge resolved:', {
        name,
        command: config.command,
        args: config.args,
        hasUrl: Boolean(config.env?.LUMOS_BROWSER_BRIDGE_URL),
        hasToken: Boolean(config.env?.LUMOS_BROWSER_BRIDGE_TOKEN),
        fromRequest: Boolean(bridgeFromRequest?.url && bridgeFromRequest?.token),
        fromRuntimeFile: Boolean(bridgeFromRuntime?.url && bridgeFromRuntime?.token),
        fromProcessEnv: Boolean(process.env.LUMOS_BROWSER_BRIDGE_URL && process.env.LUMOS_BROWSER_BRIDGE_TOKEN),
      });
    }
  }

  return Object.keys(mcpServers).length > 0 ? mcpServers : undefined;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let activeSessionId: string | undefined;
  let activeLockId: string | undefined;

  try {
    const body: SendMessageRequest & { files?: FileAttachment[]; toolTimeout?: number; provider_id?: string; systemPromptAppend?: string } = await request.json();
    const { session_id, content, model, mode, files, toolTimeout, provider_id, systemPromptAppend } = body;

    console.log('[chat API] content length:', content.length, 'first 200 chars:', content.slice(0, 200));
    console.log('[chat API] systemPromptAppend:', systemPromptAppend ? `${systemPromptAppend.length} chars` : 'none');

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

    // Capture explicit user memory instructions with conflict detection
    let capturedMemory: import('@/lib/db/memories').MemoryRecord | null = null;
    let memoryConflict: import('@/lib/db/memories').MemoryRecord | null = null;
    try {
      const result = captureExplicitMemoryWithConflictCheck({
        sessionId: session_id,
        projectPath: session.sdk_cwd || session.working_directory || undefined,
        userInput: content,
      });
      capturedMemory = result.memory;
      memoryConflict = result.conflict;
      if (capturedMemory) {
        console.log('[memory] captured explicit memory:', {
          id: capturedMemory.id,
          scope: capturedMemory.scope,
          category: capturedMemory.category,
        });
      }
      if (memoryConflict) {
        console.log('[memory] conflict detected:', {
          id: memoryConflict.id,
          content: memoryConflict.content,
        });
      }
    } catch (error) {
      console.warn('[memory] Failed to capture memory from user input:', error);
    }

    const weakSignal = detectWeakMemorySignal(content);
    if (weakSignal.matched) {
      console.log('[memory] weak signal detected:', {
        sessionId: session_id,
        score: weakSignal.score,
        labels: weakSignal.labels,
      });
    }

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
          const workDir = session.working_directory;
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

    // Link captured memory to user message
    if (capturedMemory) {
      try {
        linkMessageMemory(userMessageId, capturedMemory.id, 'created');
      } catch (error) {
        console.warn('[memory] Failed to link memory to message:', error);
      }
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

    // Determine model: request override > session model > default setting
    const effectiveModel = model || session.requested_model || session.model || getSetting('default_model') || undefined;

    // Persist model and provider to session so usage stats can group by model+provider.
    // This runs on every message but the DB writes are cheap (single UPDATE by PK).
    if (effectiveModel && effectiveModel !== (session.requested_model || session.model)) {
      updateSessionModel(session_id, effectiveModel);
    }

    // Resolve provider: explicit provider_id > default_provider_id > session provider_id > environment variables
    let resolvedProvider: import('@/types').ApiProvider | undefined;
    const defaultProviderId = getDefaultProviderId() || '';
    const effectiveProviderId = provider_id || defaultProviderId || session.provider_id || '';
    if (effectiveProviderId && effectiveProviderId !== 'env') {
      resolvedProvider = getProvider(effectiveProviderId);
      if (!resolvedProvider) {
        // Requested provider not found, try default
        if (defaultProviderId) {
          resolvedProvider = getProvider(defaultProviderId);
        }
      }
    }
    // effectiveProviderId === 'env' → resolvedProvider stays undefined → uses env vars

    const providerName = resolvedProvider?.name || '';
    if (providerName !== (session.provider_name || '')) {
      updateSessionProvider(session_id, providerName);
    }
    const persistProviderId = effectiveProviderId || provider_id || '';
    if (persistProviderId !== (session.provider_id || '')) {
      updateSessionProviderId(session_id, persistProviderId);
    }

    const sessionSystemPrompt = stripMainAgentSessionMarker(session.system_prompt || '');

    // Determine permission mode from chat mode: code → acceptEdits, plan → plan, ask → default (no tools)
    const effectiveMode = mode || session.mode || 'code';
    let permissionMode: string;
    let systemPromptOverride: string | undefined;
    switch (effectiveMode) {
      case 'plan':
        permissionMode = 'plan';
        break;
      case 'ask':
        permissionMode = 'default';
        systemPromptOverride = `${sessionSystemPrompt}${sessionSystemPrompt ? '\n\n' : ''}You are in Ask mode. Answer questions and provide information only. Do not use any tools, do not read or write files, do not execute commands. Only respond with text.`;
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

    const feishuContext = await buildFeishuOnDemandContext(content, fileAttachments);
    const promptForModel = feishuContext ? `${content}\n\n${feishuContext}` : content;
    const neutralMainAgentWorkingDirectory = process.env.LUMOS_DATA_DIR
      || process.env.CLAUDE_GUI_DATA_DIR
      || path.join(os.homedir(), '.lumos');
    const resolvedSessionWorkingDirectory = session.sdk_cwd
      || session.working_directory
      || (isMainAgentSession(session) ? neutralMainAgentWorkingDirectory : undefined);

    console.time('[perf] MCP servers loading');
    const bridgeFromRequest = readChromeBridgeEnvFromRequest(request);
    const bridgeFromRuntime = readChromeBridgeEnvFromRuntimeFile();
    const loadedMcpServers = loadMcpServers(
      resolvedSessionWorkingDirectory,
      bridgeFromRequest,
      bridgeFromRuntime,
    );
    console.timeEnd('[perf] MCP servers loading');

    let teamRuntimeState: ReturnType<typeof getMainAgentSessionTeamRuntimeState> = null;

    // Append per-request system prompt (e.g. skill injection for image generation)
    let finalSystemPrompt = systemPromptOverride || sessionSystemPrompt || undefined;
    if (systemPromptAppend) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + systemPromptAppend;
    }
    if (isMainAgentSession(session)) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + MAIN_AGENT_PRIMARY_SESSION_HINT;
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + TASK_MANAGEMENT_HINT;
    }
    finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + MAIN_AGENT_TEAM_MODE_SYSTEM_HINT;
    if (isMainAgentSession(session)) {
      const teamConfigurationPrompt = getMainAgentTeamConfigurationPrompt();
      if (teamConfigurationPrompt) {
        finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + teamConfigurationPrompt;
      }
      teamRuntimeState = getMainAgentSessionTeamRuntimeState(session_id);
      const teamRuntimePrompt = getMainAgentSessionTeamRuntimePrompt(session_id);
      if (teamRuntimePrompt) {
        finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + teamRuntimePrompt;
      }
    }
    if (
      permissionMode !== 'default'
      && hasGeminiImageMcp(loadedMcpServers)
      && !isLegacyImageAgentPrompt(systemPromptAppend)
    ) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + GEMINI_IMAGE_MCP_SYSTEM_HINT;
    }
    if (permissionMode !== 'default' && hasFeishuMcp(loadedMcpServers)) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + FEISHU_REPORT_MCP_SYSTEM_HINT;
    }

    // Load recent conversation history from DB as fallback context.
    // This is used when SDK session resume is unavailable or fails,
    // so the model still has conversation context.
    const { messages: recentMsgs } = getMessages(session_id, { limit: 50 });
    // Exclude the user message we just saved (last in the list) — it's already the prompt
    let historyMsgs = recentMsgs.slice(0, -1).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: stripFeishuDirectives(m.content),
    }));
    if (isMainAgentSession(session)) {
      historyMsgs = normalizeMainAgentConversationHistoryForTeamRuntime(historyMsgs, teamRuntimeState);
    }

    // Stream Claude response, using SDK session ID for resume if available
    console.log('[chat API] streamClaude params:', {
      promptLength: promptForModel.length,
      promptFirst200: promptForModel.slice(0, 200),
      sdkSessionId: session.sdk_session_id || 'none',
      systemPromptLength: finalSystemPrompt?.length || 0,
      systemPromptFirst200: finalSystemPrompt?.slice(0, 200) || 'none',
      mcpServers: loadedMcpServers ? Object.keys(loadedMcpServers) : 'none',
    });

    // Debug: Print full system prompt
    console.log('[chat API] ========== FULL SYSTEM PROMPT ==========');
    console.log(finalSystemPrompt || '(empty)');
    console.log('[chat API] ========== END SYSTEM PROMPT ==========');

    const claudeStream = streamClaude({
      prompt: promptForModel,
      rawPrompt: content,
      sessionId: session_id,
      sdkSessionId: session.sdk_session_id || undefined,
      model: effectiveModel,
      systemPrompt: finalSystemPrompt,
      workingDirectory: resolvedSessionWorkingDirectory,
      mcpServers: loadedMcpServers,
      abortController,
      permissionMode,
      files: fileAttachments,
      toolTimeoutSeconds: toolTimeout || 300,
      provider: resolvedProvider,
      conversationHistory: historyMsgs,
      onRuntimeStatusChange: (status: string) => {
        try { setSessionRuntimeStatus(session_id, status); } catch { /* best effort */ }
      },
    });

    // Prepend memory event if captured or conflict detected
    const stream = capturedMemory
      ? prependMemoryEvent(claudeStream, capturedMemory, 'captured')
      : memoryConflict
      ? prependMemoryEvent(claudeStream, memoryConflict, 'conflict', content)
      : claudeStream;

    // Tee the stream: one for client, one for collecting the response
    const [streamForClient, streamForCollect] = stream.tee();

    // Save assistant message in background, with cleanup callback to release lock
    collectStreamResponse(streamForCollect, {
      sessionId: session_id,
      weakSignalDetected: weakSignal.matched,
      onComplete: () => {
        releaseSessionLock(session_id, lockId);
        setSessionRuntimeStatus(session_id, 'idle');
      },
    });

    return new Response(streamForClient, {
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
    weakSignalDetected?: boolean;
    onComplete?: () => void;
  },
) {
  const sessionId = options.sessionId;
  const reader = stream.getReader();
  const contentBlocks: MessageContentBlock[] = [];
  let currentText = '';
  let tokenUsage: TokenUsage | null = null;

  const triggerWeakSignalMemory = async () => {
    if (!options.weakSignalDetected) return;
    try {
      const result = await runMemoryIntelligenceForSession({
        sessionId,
        trigger: 'weak_signal',
      });
      console.log('[memory] weak-signal trigger result:', {
        sessionId,
        outcome: result.outcome,
        savedCount: result.savedCount,
        reason: result.reason,
      });
    } catch (error) {
      console.warn('[memory] weak-signal trigger failed:', error);
    }
  };

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
      const hasToolBlocks = contentBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result'
      );

      const content = hasToolBlocks
        ? JSON.stringify(contentBlocks)
        : contentBlocks
            .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();

      if (content) {
        const storedContent = hasToolBlocks ? content : stripFeishuDirectives(content);
        if (storedContent) {
          const storedMessage = addMessage(
            sessionId,
            'assistant',
            storedContent,
            tokenUsage ? JSON.stringify(tokenUsage) : null,
          );
          persistTeamPlanFromAssistantContent(sessionId, content, storedMessage.id);
        }
        syncAssistantContentToFeishu(sessionId, content).catch(err =>
          console.error('[Sync] Assistant message sync failed:', err),
        );
        void triggerWeakSignalMemory();

      }
    }
  } catch {
    // Stream reading error - best effort save
    if (currentText.trim()) {
      contentBlocks.push({ type: 'text', text: currentText });
    }
    if (contentBlocks.length > 0) {
      const hasToolBlocks = contentBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result'
      );
      const content = hasToolBlocks
        ? JSON.stringify(contentBlocks)
        : contentBlocks
            .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();
      if (content) {
        const storedContent = hasToolBlocks ? content : stripFeishuDirectives(content);
        if (storedContent) {
          const storedMessage = addMessage(sessionId, 'assistant', storedContent);
          persistTeamPlanFromAssistantContent(sessionId, content, storedMessage.id);
        }
        syncAssistantContentToFeishu(sessionId, content).catch(err =>
          console.error('[Sync] Assistant message sync failed:', err),
        );
        void triggerWeakSignalMemory();

      }
    }
  } finally {
    options.onComplete?.();
  }
}
