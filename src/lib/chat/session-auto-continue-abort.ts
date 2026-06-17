const activeAutoContinueControllers = new Map<string, AbortController>();

export function registerSessionAutoContinueAbort(sessionId: string, controller: AbortController): void {
  if (!sessionId) return;
  activeAutoContinueControllers.set(sessionId, controller);
}

export function unregisterSessionAutoContinueAbort(sessionId: string, controller: AbortController): void {
  if (activeAutoContinueControllers.get(sessionId) === controller) {
    activeAutoContinueControllers.delete(sessionId);
  }
}

export function abortSessionAutoContinue(sessionId: string): boolean {
  const controller = activeAutoContinueControllers.get(sessionId);
  if (!controller) return false;
  controller.abort();
  activeAutoContinueControllers.delete(sessionId);
  return true;
}
