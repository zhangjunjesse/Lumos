import {
  addMessage,
  dataDir,
  getMessages,
  getSession,
  updateSdkSessionId,
  updateSessionResolvedModel,
} from '@/lib/db';
import { resolveEnabledMcpServers } from '@/lib/mcp-resolver';
import { streamClaude } from '@/lib/claude-client';
import {
  buildCapabilityPlan,
  buildDbServerHints,
} from '@/lib/agent-capabilities/registry';
import type { ConnectorContext } from '@/lib/agent-capabilities/types';
import { hasImToolsMcp } from '@/lib/im';
import { buildLatestAppImNotificationHint } from '@/lib/app/im-bridge';
import { getActiveUserId } from '@/lib/auth/user-service';
import { isMainAgentSession } from '@/lib/chat/session-entry';
import { isWeChatAssistantChatSession } from '@/lib/chat/wechat-assistant-session';
import { isWorkflowChatSession } from '@/lib/chat/workflow-session';
import { isEcommerceAssistantChatSession } from '@/lib/chat/ecommerce-assistant-session';
import { stripLeakedToolTraceText } from '@/lib/chat/tool-trace-sanitizer';
import type { FileAttachment, MCPServerConfig, MessageContentBlock, TokenUsage } from '@/types';
import fs from 'node:fs';
import path from 'node:path';

const SPEECH_TO_TEXT_MCP_SYSTEM_HINT = `You have access to Lumos speech-to-text tools (server name: \`speech-to-text\`) for audio transcription.

Available tool:
- \`transcribe_audio\` — transcribe wav/mp3/m4a/ogg/aac/amr/silk/flac/webm/opus audio. Prefer the \`file_path\` parameter for attached local files.

How the result is shaped:
- \`transcribe_audio\` does NOT return the transcribed text inline. It returns metadata only: \`transcript_file\` (absolute path under \`~/.lumos/transcripts/\`), \`char_count\`, \`duration_seconds\`, \`charged_amount\`, \`audio_name\`, etc.
- To obtain the text, call the \`Read\` tool with \`file_path = transcript_file\`. For long transcripts, use \`offset\` / \`limit\` on Read to page through.
- Downstream tools that accept a file path (e.g. office-docs Word/PDF generators, summarizers that accept a file) should be passed \`transcript_file\` directly; do not stuff the full text into their arguments.

Rules:
- When the user attaches or references an audio file and asks what it says, call \`transcribe_audio\` before doing anything else.
- Use only \`transcribe_audio\` for ASR. Do not use Bash, ffmpeg, local whisper, or external skills as the transcription path.
- If \`transcribe_audio\` reports a timeout or large-file error, report that exact error; do not manually split or convert the file in the agent. The MCP/runtime owns audio preprocessing.
- If the tool reports \`SPEECH_PROVIDER_NOT_CONFIGURED\`, tell the user to open Settings → Providers → Speech.
- If the tool returns a charge amount or duration, report it transparently.
- **DEFAULT TO RETURNING THE FULL TRANSCRIPT VERBATIM.** When the user asks to transcribe / 转文字 / 录音转文字 / 帮我整理录音, Read the \`transcript_file\` and include the entire text in your reply. Do NOT replace it with a summary, executive bullets, or a "the recording discusses ABC" paragraph unless the user explicitly asked for a summary ("总结一下" / "summarize" / "概括"). If the transcript is long, send it as-is and let the IM layer split it; do not pre-shorten it.
- After delivering the transcript, you may offer next steps (export to Word/PDF, summarize, translate) in a separate short follow-up sentence — but the transcript itself comes first and complete.`;

const MAIN_AGENT_IM_ENTRY_HINT = `This conversation is the Lumos Main Agent space and may receive messages from external IM channels like WeChat.
Treat the user as talking to Lumos itself. If the user asks to inspect or continue another Lumos conversation, use the Lumos butler read-only tools to find or summarize it. Do not claim that you transferred execution into another conversation unless a dedicated transfer tool is available.

Conversation hygiene over IM:
- Do not re-ask for information the user has already given in this conversation. If they said "Word, send via WeChat" once, that's the answer — go execute, do not confirm "what format? where to send?" again on the next turn.
- Prefer doing the work over running a clarification dialog. If a request has one clearly likely interpretation, act on it and report what you did; ask only when the choices materially diverge (e.g. destructive vs. read-only).
- When a tool fails, fix the cause yourself (correct path, retry the right tool) before bouncing the failure back to the user. Hand back only when the failure genuinely needs the user's input (missing credential, ambiguous target).`;

/**
 * Strip routing-only HTML-comment directives like `<!--source:wechat-->` and
 * `<!--feishu_mentions:[...]-->` before feeding history back to the model.
 *
 * The `<!--files:[...]-->` directive is intentionally PRESERVED. It carries
 * the on-disk path of each attachment, which the downstream history
 * normalizer (`normalizeHistoryMessageForFallback` in claude-client) needs to
 * surface as `[Attached file: name=..., path=...]` so a fallback turn can
 * still operate on the original file. Stripping it here used to lose the
 * path entirely and forced the model to hallucinate one.
 */
export function stripContentDirectives(content: string): string {
  return content
    .replace(/<!--(?!files:)[a-zA-Z0-9_-]+:[\s\S]*?-->/g, '')
    .trim();
}

/**
 * When an inbound IM message kicks off this turn, the dispatcher knows the
 * exact chatId we should reply / push to. Tell the model so it doesn't ask
 * the user "what's your wechat id?" — it already has it.
 */
function buildImContextHint(providerId: string, chatId: string): string {
  return [
    `**Active IM context** — this turn was triggered by an inbound message on \`${providerId}\`.`,
    `When the user says "send X to me" / "发给我" / "推到微信" without naming a target, the chatId is already known:`,
    ``,
    `  providerId: ${providerId}`,
    `  chatId:     ${chatId}`,
    ``,
    `Call \`mcp__im-tools__im_send_attachment\` (or \`im_send\`) directly with this chatId; do NOT ask the user for their wxid / openid.`,
    `If the user asks you to generate/draw/create an image in this IM conversation, call \`mcp__lumos-image__generate_image\` first. Then embed the generated image using the tool_result \`url\` field as Markdown image syntax; the IM dispatcher will convert it into a real image attachment. Do not answer with only a plain image URL.`,
    `If you already have a public image URL to send, embed it as \`![image](https://.../file.png)\` instead of plain text so the IM dispatcher can download it and send it as an image attachment when safe.`,
  ].join('\n');
}

function hasSpeechToTextMcp(
  servers: Record<string, MCPServerConfig> | undefined,
): boolean {
  if (!servers) return false;
  return Boolean(servers['speech-to-text']);
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
    // source: any IM provider id ('feishu' | 'wechat' | future...) 或 'lumos'
    // imContext: 当本轮对话由 IM inbound 触发时传入，让 AI 知道"回这条消息
    //            走哪个 provider / 哪个 chatId"，im_send_attachment 这类工具
    //            可以直接复用，不必再问用户
    meta?: {
      source?: string;
      imContext?: { providerId: string; chatId: string };
    },
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

    // SDK resume 是不可靠的兜底（每次 fork 出新 session_id 后，SDK 实际只保留最近
    // 几轮 turn，老历史可能丢失）。chat/route.ts 在 lumos UI 里走 conversationHistory
    // 兜底；之前这条路径没传，导致 wechat / 飞书入站消息每次 AI 都说"这是第一条对话"。
    // 拉最近 50 条作为 fallback context；注释 directive 要 strip 掉，不让模型读到。
    const { messages: recentMsgs } = getMessages(sessionId, { limit: 50 });
    const conversationHistory = recentMsgs
      .slice(0, -1) // exclude the user message we just saved
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: stripContentDirectives(m.content),
      }));

    const activeUserId = getActiveUserId();
    const mainAgentSession = isMainAgentSession(session);
    const connectorContext: ConnectorContext = {
      sessionId,
      userId: activeUserId,
      permissionMode: 'acceptEdits',
      browserAutomationIntent: false,
      visibleBrowserIntent: false,
      legacyImageAgentPrompt: false,
      isPrimaryMainAgentSession: mainAgentSession,
      isDedicatedWeChatAssistantSession: isWeChatAssistantChatSession(session),
      isWorkflowChatSession: isWorkflowChatSession(session),
      isEcommerceAssistantChatSession: isEcommerceAssistantChatSession(session),
      knowledgeEnabledForRequest: false,
      selectedKnowledgeTagIds: [],
    };
    const capabilityPlan = buildCapabilityPlan(connectorContext);
    const loadedMcpServers = resolveEnabledMcpServers({
      sessionWorkingDirectory: session.working_directory || undefined,
      sessionId,
      skipNames: capabilityPlan.dbMcpSkipNames,
      browserBackground: true,
    });
    const hints: string[] = [];

    if (mainAgentSession) {
      hints.push(MAIN_AGENT_IM_ENTRY_HINT);
    }
    if (capabilityPlan.systemHintAppend) hints.push(capabilityPlan.systemHintAppend);
    const dbServerHints = buildDbServerHints(
      connectorContext,
      new Set(Object.keys(loadedMcpServers || {})),
    );
    if (dbServerHints) hints.push(dbServerHints);
    if (hasSpeechToTextMcp(loadedMcpServers)) {
      hints.push(SPEECH_TO_TEXT_MCP_SYSTEM_HINT);
    }
    if (hasImToolsMcp(loadedMcpServers)) {
      if (meta?.imContext) {
        hints.push(buildImContextHint(meta.imContext.providerId, meta.imContext.chatId));
      }
    }
    if (mainAgentSession && meta?.imContext) {
      try {
        const appNotificationHint = buildLatestAppImNotificationHint(
          meta.imContext.providerId,
          meta.imContext.chatId,
        );
        if (appNotificationHint) hints.push(appNotificationHint);
      } catch (err) {
        console.warn('[conversation-engine] failed to load app IM context:', err);
      }
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
      inProcessMcpServers: Object.keys(capabilityPlan.inProcessServers).length > 0
        ? capabilityPlan.inProcessServers
        : undefined,
      inProcessVariantKeys: capabilityPlan.inProcessVariantKeys,
      systemPrompt,
      conversationHistory,
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
        callbacks?.onVisibleText?.(stripLeakedToolTraceText(nextVisible));
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

    const sanitizedContentBlocks = contentBlocks
      .map((block) => {
        if (block.type !== 'text') return block;
        return { ...block, text: stripLeakedToolTraceText(block.text) };
      })
      .filter((block) => block.type !== 'text' || block.text.trim().length > 0);

    if (sanitizedContentBlocks.length > 0) {
      const hasStructuredBlocks = sanitizedContentBlocks.some((b) => b.type !== 'text');

      const content = hasStructuredBlocks
        ? JSON.stringify(sanitizedContentBlocks)
        : sanitizedContentBlocks
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

        visibleText = sanitizedContentBlocks
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
