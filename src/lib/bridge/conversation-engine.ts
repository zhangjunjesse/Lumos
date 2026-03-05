import { addMessage, getSession } from '@/lib/db';
import { streamClaude } from '@/lib/claude-client';

export class ConversationEngine {
  private sessions = new Map<string, any>();

  async sendMessage(sessionId: string, text: string): Promise<string> {
    const session = getSession(sessionId);
    if (!session) throw new Error('Session not found');

    addMessage(sessionId, 'user', text);

    const stream = streamClaude({
      prompt: text,
      sessionId,
      sdkSessionId: session.sdk_session_id || undefined,
      model: session.model || undefined,
      workingDirectory: session.working_directory || undefined,
      permissionMode: 'acceptEdits',
    });

    let response = '';
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
              if (event.type === 'text') response += event.data;
            } catch {}
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (response.trim()) {
      addMessage(sessionId, 'assistant', response.trim());
    }

    return response.trim() || 'No response';
  }

  async createSession(sessionId: string): Promise<void> {
    this.sessions.set(sessionId, { id: sessionId, createdAt: new Date().toISOString() });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
