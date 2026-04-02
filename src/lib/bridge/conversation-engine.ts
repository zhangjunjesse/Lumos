import {
  addMessage,
  dataDir,
  getSession,
  updateSdkSessionId,
  updateSessionResolvedModel,
} from '@/lib/db';
import { resolveEnabledMcpServers } from '@/lib/mcp-resolver';
import { streamClaude } from '@/lib/claude-client';
import { createLumosMcpServer } from '@/lib/tools/lumos-mcp-server';
import { IMAGE_GEN_IN_PROCESS_HINT } from '@/lib/tools/image-gen-hints';
import type { FileAttachment, MCPServerConfig, MessageContentBlock, TokenUsage } from '@/types';
import fs from 'node:fs';
import path from 'node:path';

const FEISHU_MCP_SYSTEM_HINT = `You have access to Feishu MCP tools (server name: \`feishu\`) for reading/editing Feishu docs, sheets, wikis, drive, and reports. All tool names use the format \`mcp__feishu__<tool>\`.

**Docs & Wiki** — pass any feishu.cn URL directly:
- \`mcp__feishu__feishu_doc_read\` — read a doc/wiki/docx by URL (returns Markdown). Works for wiki links too.
- \`mcp__feishu__feishu_doc_append\` — append content to a doc
- \`mcp__feishu__feishu_doc_update_block\` — update a specific block in a doc
- \`mcp__feishu__feishu_doc_get_blocks\` / \`mcp__feishu__feishu_doc_create\` / \`mcp__feishu__feishu_doc_overwrite\` — advanced doc ops

**Sheets** (for spreadsheet URLs, NOT doc URLs):
- \`mcp__feishu__feishu_sheet_read\` — read sheet data
- \`mcp__feishu__feishu_sheet_append_rows\` / \`mcp__feishu__feishu_sheet_update_cells\` — write to sheets

**Drive & Wiki browse**:
- \`mcp__feishu__feishu_search\` — search docs/sheets/wiki across drive
- \`mcp__feishu__feishu_drive_list\` — list files in a folder
- \`mcp__feishu__feishu_wiki_list_spaces\` — browse wiki spaces/nodes

**Images**: \`mcp__feishu__feishu_image_list\` / \`mcp__feishu__feishu_image_download\`

**Reports** (汇报/weekly/daily summaries):
- \`mcp__feishu__feishu_report_list\` — find report tasks
- \`mcp__feishu__feishu_report_read\` — read a report task detail

**Auth**: \`mcp__feishu__feishu_auth_status\` — check auth; if not logged in, tell user to login in Lumos.

Rules:
- To read any feishu.cn doc or wiki link: call \`mcp__feishu__feishu_doc_read\` with the URL directly.
- Do not claim content before successful tool_result.
- If API reports missing scopes, tell user which scope to enable.`;
const DEEPSEARCH_MCP_SYSTEM_HINT = `You have access to built-in DeepSearch tools for deep web research with shared browser login state. Use them for anti-bot sites like Zhihu, WeChat public articles, Xiaohongshu, Juejin, and Twitter/X.

Available DeepSearch tools (server name: \`deepsearch\`):
- \`mcp__deepsearch__start\` — start a DeepSearch run. Required param: \`query\` (string). Optional: \`sites\` (array of site keys: zhihu, wechat, xiaohongshu, juejin, x).
- \`mcp__deepsearch__get_result\` — poll run status and read captured snippets. Required param: \`runId\` (string returned by start).
- \`mcp__deepsearch__pause\` / \`mcp__deepsearch__resume\` / \`mcp__deepsearch__cancel\` — control run lifecycle. Required param: \`runId\`.

Workflow: call \`mcp__deepsearch__start\` → poll \`mcp__deepsearch__get_result\` until status is \`completed\` or \`partial\` → summarize results.

Rules:
- Do NOT use raw browser tools when the user wants DeepSearch — use these tools instead.
- Prefer \`managed_page\` and \`best_effort\` by default.
- If \`mcp__deepsearch__get_result\` returns \`waiting_login\`, tell the user to finish login in Extensions → DeepSearch, then call \`mcp__deepsearch__resume\`.
- Never fabricate search results — only report what the tool_result actually contains.`;

function hasFeishuMcp(
  servers: Record<string, MCPServerConfig> | undefined,
): boolean {
  if (!servers) return false;
  return Boolean(servers.feishu);
}

function hasDeepSearchMcp(
  servers: Record<string, MCPServerConfig> | undefined,
): boolean {
  if (!servers) return false;
  return Boolean(servers.deepsearch);
}

interface ConversationResponse {
  visibleText: string;
  rawContent: string;
}

interface ConversationStreamingCallbacks {
  onVisibleText?: (text: string) => void;
}

export class ConversationEngine {
  private sessions = new Map<string, { id: string; createdAt: string }>();

  async sendMessage(
    sessionId: string,
    text: string,
    files?: FileAttachment[],
    meta?: { source?: 'feishu' | 'lumos' },
    callbacks?: ConversationStreamingCallbacks,
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

    const loadedMcpServers = resolveEnabledMcpServers({
      sessionWorkingDirectory: session.working_directory || undefined,
      sessionId,
    });
    const hints: string[] = [];

    // In-process image gen tool replaces the external gemini-image MCP hint
    const lumosMcpServer = createLumosMcpServer(sessionId);
    hints.push(IMAGE_GEN_IN_PROCESS_HINT);
    if (hasFeishuMcp(loadedMcpServers)) {
      hints.push(FEISHU_MCP_SYSTEM_HINT);
    }
    if (hasDeepSearchMcp(loadedMcpServers)) {
      hints.push(DEEPSEARCH_MCP_SYSTEM_HINT);
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
      inProcessMcpServers: { [lumosMcpServer.name]: lumosMcpServer },
      systemPrompt,
    });

    const contentBlocks: MessageContentBlock[] = [];
    let currentText = '';
    let tokenUsage: TokenUsage | null = null;
    let visibleText = '';
    let rawAssistantContent = '';
    const emitVisibleText = () => {
      const committedText = contentBlocks
        .filter(
          (b): b is Extract<MessageContentBlock, { type: 'text' }> =>
            b.type === 'text',
        )
        .map((b) => b.text)
        .join('\n\n')
        .trim();
      const nextVisible = [committedText, currentText.trim()].filter(Boolean).join('\n\n').trim();
      if (nextVisible) {
        callbacks?.onVisibleText?.(nextVisible);
      }
    };

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
                emitVisibleText();
              } else if (event.type === 'tool_use_summary') {
                if (currentText.trim()) {
                  contentBlocks.push({ type: 'text', text: currentText });
                  currentText = '';
                  emitVisibleText();
                }
                try {
                  const summaryData = JSON.parse(event.data);
                  const summary = typeof summaryData.summary === 'string' ? summaryData.summary.trim() : '';
                  if (summary) {
                    contentBlocks.push({ type: 'reasoning', summary });
                  }
                } catch {
                  const summary = typeof event.data === 'string' ? event.data.trim() : '';
                  if (summary) {
                    contentBlocks.push({ type: 'reasoning', summary });
                  }
                }
              } else if (event.type === 'tool_use') {
                if (currentText.trim()) {
                  contentBlocks.push({ type: 'text', text: currentText });
                  currentText = '';
                  emitVisibleText();
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
      currentText = '';
      emitVisibleText();
    }

    if (contentBlocks.length > 0) {
      const hasStructuredBlocks = contentBlocks.some((b) => b.type !== 'text');

      const content = hasStructuredBlocks
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
