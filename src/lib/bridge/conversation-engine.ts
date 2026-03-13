import {
  addMessage,
  dataDir,
  getAllProviders,
  getEnabledMcpServersAsConfig,
  getSession,
  updateSdkSessionId,
  updateSessionResolvedModel,
} from '@/lib/db';
import { streamClaude } from '@/lib/claude-client';
import { getFeishuCredentials } from '@/lib/feishu-config';
import type { FileAttachment, MCPServerConfig, MessageContentBlock, TokenUsage } from '@/types';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-image-preview';
const CHROME_MCP_NAMES = new Set(['chrome-devtools', 'chrome_devtools']);
const GEMINI_IMAGE_MCP_SYSTEM_HINT = `When user asks to generate, draw, edit, or restyle images, use MCP tool \`generate_image\` from \`gemini-image\`.
Do not ask user to edit \`.kiro/settings/mcp.json\`, \`.claude.json\`, or external config files. MCP in Lumos is managed internally via Settings -> Providers.
For image requests, call tool first; only claim success after successful tool_result with image paths.
If user asks to send generated files to Feishu, include \`FEISHU_SEND_FILE::<absolute_path>\` on separate lines.`;
const FEISHU_REPORT_MCP_SYSTEM_HINT = `When user asks for Feishu reports, weekly reports, daily reports, monthly summaries, or "汇报", prefer MCP tools from \`feishu\`:
- \`feishu_report_list\`: list report tasks first.
- \`feishu_report_read\`: read selected report task detail.
These tools target Feishu report app APIs (\`report/v1\`), not generic docs search.
If API reports missing scopes, tell user to enable app identity scopes: \`report:rule:readonly\` and \`report:task:readonly\`.
Do not claim report content before successful tool_result.`;

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

function resolveChromeBridgeEnv(existingEnv?: Record<string, string>): Record<string, string> {
  const env = { ...(existingEnv || {}) };
  let runtimeBridge: { url?: string; token?: string } = {};
  try {
    const dataDirPath = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
    const runtimePath = path.join(dataDirPath, 'runtime', 'browser-bridge.json');
    if (fs.existsSync(runtimePath)) {
      const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as { url?: unknown; token?: unknown };
      runtimeBridge = {
        url: typeof parsed.url === 'string' ? parsed.url : undefined,
        token: typeof parsed.token === 'string' ? parsed.token : undefined,
      };
    }
  } catch {
    // ignore runtime bridge file parse errors
  }

  env.LUMOS_BROWSER_BRIDGE_URL = pickNonEmpty(
    process.env.LUMOS_BROWSER_BRIDGE_URL,
    runtimeBridge.url,
    env.LUMOS_BROWSER_BRIDGE_URL,
  );
  env.LUMOS_BROWSER_BRIDGE_TOKEN = pickNonEmpty(
    process.env.LUMOS_BROWSER_BRIDGE_TOKEN,
    runtimeBridge.token,
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

function loadMcpServers(sessionWorkingDirectory?: string): Record<string, MCPServerConfig> | undefined {
  const mcpServers = getEnabledMcpServersAsConfig();
  const { appId: feishuAppId, appSecret: feishuAppSecret } = getFeishuCredentials();

  let runtimePath: string;
  if (process.env.NODE_ENV === 'production' && typeof process.resourcesPath === 'string') {
    runtimePath = process.resourcesPath;
  } else {
    runtimePath = path.join(process.cwd(), 'resources');
  }

  const dataDirPath = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
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
          .replace('[DATA_DIR]', dataDirPath)
          .replace(/^~\//, os.homedir() + '/');
      });
    }
    if (config.env) {
      const resolvedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(config.env)) {
        resolvedEnv[key] = value
          .replace('[RUNTIME_PATH]', runtimePath)
          .replace('[WORKSPACE_PATH]', workspacePath)
          .replace('[DATA_DIR]', dataDirPath)
          .replace(/^~\//, os.homedir() + '/');
      }
      config.env = resolvedEnv;
    }

    if (name === 'feishu') {
      config.env = {
        ...config.env,
        FEISHU_APP_ID: feishuAppId,
        FEISHU_APP_SECRET: feishuAppSecret,
        FEISHU_TOKEN_PATH: path.join(dataDirPath, 'auth', 'feishu.json'),
      };
    }

    if (name === 'bilibili' && !config.env?.BILIBILI_SESSDATA) {
      config.env = {
        ...config.env,
        BILIBILI_SESSDATA: process.env.BILIBILI_SESSDATA || '',
      };
    }

    if (name === 'gemini-image' || name === 'gemini_image') {
      config.env = resolveGeminiMcpEnv(config.env, sessionWorkingDirectory);
    }

    if (CHROME_MCP_NAMES.has(name)) {
      config.env = resolveChromeBridgeEnv(config.env);
    }
  }

  return Object.keys(mcpServers).length > 0 ? mcpServers : undefined;
}

interface ConversationResponse {
  visibleText: string;
  rawContent: string;
}

export class ConversationEngine {
  private sessions = new Map<string, { id: string; createdAt: string }>();

  async sendMessage(
    sessionId: string,
    text: string,
    files?: FileAttachment[],
    meta?: { source?: 'feishu' | 'lumos' },
  ): Promise<ConversationResponse> {
    const session = getSession(sessionId);
    if (!session) throw new Error('Session not found');

    // Save user message — persist file metadata so attachments survive page reload
    let savedContent = text;
    if (meta?.source) {
      savedContent = `<!--source:${meta.source}-->${savedContent}`;
    }
    if (files && files.length > 0) {
      const workDir = session.working_directory || dataDir;
      const uploadDir = path.join(workDir, '.lumos-uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const fileMeta = files.map((f) => {
        if (f.filePath) {
          return { id: f.id, name: f.name, type: f.type, size: f.size, filePath: f.filePath };
        }
        const safeName = path.basename(f.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`);
        const buffer = Buffer.from(f.data, 'base64');
        fs.writeFileSync(filePath, buffer);
        // Mutate the attachment so streamClaude can reuse the persisted path
        f.filePath = filePath;
        return { id: f.id, name: f.name, type: f.type, size: buffer.length, filePath };
      });

      savedContent = `<!--files:${JSON.stringify(fileMeta)}-->${savedContent}`;
    }

    addMessage(sessionId, 'user', savedContent);

    const loadedMcpServers = loadMcpServers(session.working_directory || undefined);
    const hints: string[] = [];
    if (hasGeminiImageMcp(loadedMcpServers)) {
      hints.push(GEMINI_IMAGE_MCP_SYSTEM_HINT);
    }
    if (hasFeishuMcp(loadedMcpServers)) {
      hints.push(FEISHU_REPORT_MCP_SYSTEM_HINT);
    }
    const systemPrompt = hints.length > 0 ? hints.join('\n\n') : undefined;

    const stream = streamClaude({
      prompt: text,
      sessionId,
      sdkSessionId: session.sdk_session_id || undefined,
      model: session.requested_model || session.model || undefined,
      workingDirectory: session.working_directory || undefined,
      permissionMode: 'acceptEdits',
      files,
      mcpServers: loadedMcpServers,
      systemPrompt,
    });

    const contentBlocks: MessageContentBlock[] = [];
    let currentText = '';
    let tokenUsage: TokenUsage | null = null;
    let visibleText = '';
    let rawAssistantContent = '';

    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = value.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'text') {
                currentText += event.data;
              } else if (event.type === 'tool_use') {
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
                  // ignore malformed tool_use
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
                  // ignore malformed tool_result
                }
              } else if (event.type === 'status') {
                try {
                  const statusData = JSON.parse(event.data);
                  if (statusData.session_id) {
                    updateSdkSessionId(sessionId, statusData.session_id);
                  }
                  if (statusData.model) {
                    updateSessionResolvedModel(sessionId, statusData.model);
                  }
                } catch {
                  // ignore malformed status
                }
              } else if (event.type === 'result') {
                try {
                  const resultData = JSON.parse(event.data);
                  if (resultData.usage) {
                    tokenUsage = resultData.usage as TokenUsage;
                  }
                  if (resultData.session_id) {
                    updateSdkSessionId(sessionId, resultData.session_id);
                  }
                } catch {
                  // ignore malformed result
                }
              }
            } catch {}
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (currentText.trim()) {
      contentBlocks.push({ type: 'text', text: currentText });
    }

    if (contentBlocks.length > 0) {
      const hasToolBlocks = contentBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result',
      );

      const content = hasToolBlocks
        ? JSON.stringify(contentBlocks)
        : contentBlocks
            .filter(
              (b): b is Extract<MessageContentBlock, { type: 'text' }> =>
                b.type === 'text',
            )
            .map((b) => b.text)
            .join('')
            .trim();

      if (content) {
        rawAssistantContent = content;
        addMessage(
          sessionId,
          'assistant',
          content,
          tokenUsage ? JSON.stringify(tokenUsage) : null,
        );

        visibleText = contentBlocks
          .filter(
            (b): b is Extract<MessageContentBlock, { type: 'text' }> =>
              b.type === 'text',
          )
          .map((b) => b.text)
          .join('\n\n')
          .trim();
      }
    }

    return {
      visibleText: visibleText || 'No response',
      rawContent: rawAssistantContent || visibleText || '',
    };
  }

  async createSession(sessionId: string): Promise<void> {
    this.sessions.set(sessionId, { id: sessionId, createdAt: new Date().toISOString() });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
