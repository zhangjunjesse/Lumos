const streamControllerRegistry = new Map<string, AbortController>();

export function registerChatStreamController(sessionId: string, controller: AbortController): void {
  if (!sessionId) return;
  streamControllerRegistry.set(sessionId, controller);
}

export function getChatStreamController(sessionId: string): AbortController | null {
  if (!sessionId) return null;
  return streamControllerRegistry.get(sessionId) ?? null;
}

export function abortChatStream(sessionId: string): boolean {
  const controller = getChatStreamController(sessionId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function clearChatStreamController(sessionId: string, controller?: AbortController | null): void {
  if (!sessionId) return;
  const existing = streamControllerRegistry.get(sessionId);
  if (!existing) return;
  if (!controller || existing === controller) {
    streamControllerRegistry.delete(sessionId);
  }
}
