export class ConversationEngine {
  private sessions = new Map<string, any>();

  async sendMessage(sessionId: string, text: string): Promise<string> {
    // TODO: 集成 Claude SDK
    return `Echo: ${text}`;
  }

  async createSession(sessionId: string): Promise<void> {
    this.sessions.set(sessionId, { id: sessionId, createdAt: new Date().toISOString() });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
