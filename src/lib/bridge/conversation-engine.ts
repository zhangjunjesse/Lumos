import {
  addMessage,
  dataDir,
  getSession,
  updateSdkSessionId,
  updateSessionModel,
} from '@/lib/db';
import { streamClaude } from '@/lib/claude-client';
import type { FileAttachment, MessageContentBlock, TokenUsage } from '@/types';
import fs from 'node:fs';
import path from 'node:path';

export class ConversationEngine {
  private sessions = new Map<string, any>();

  async sendMessage(
    sessionId: string,
    text: string,
    files?: FileAttachment[],
  ): Promise<string> {
    const session = getSession(sessionId);
    if (!session) throw new Error('Session not found');

    // Save user message — persist file metadata so attachments survive page reload
    let savedContent = text;
    if (files && files.length > 0) {
      const workDir = session.working_directory || dataDir;
      const uploadDir = path.join(workDir, '.codepilot-uploads');
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
        return { id: f.id, name: f.name, type: f.type, size: buffer.length, filePath };
      });

      savedContent = `<!--files:${JSON.stringify(fileMeta)}-->${text}`;
    }

    addMessage(sessionId, 'user', savedContent);

    const stream = streamClaude({
      prompt: text,
      sessionId,
      sdkSessionId: session.sdk_session_id || undefined,
      model: session.model || undefined,
      workingDirectory: session.working_directory || undefined,
      permissionMode: 'acceptEdits',
      files,
    });

    const contentBlocks: MessageContentBlock[] = [];
    let currentText = '';
    let tokenUsage: TokenUsage | null = null;
    let visibleText = '';

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
                    updateSessionModel(sessionId, statusData.model);
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

    return visibleText || 'No response';
  }

  async createSession(sessionId: string): Promise<void> {
    this.sessions.set(sessionId, { id: sessionId, createdAt: new Date().toISOString() });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
