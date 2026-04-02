import type { CodeHandler } from './code-handler-types';

const handlers = new Map<string, CodeHandler>();

/**
 * 注册一个代码处理器
 */
export function registerCodeHandler(handler: CodeHandler): void {
  if (handlers.has(handler.id)) {
    console.warn(`[code-handler-registry] Overwriting handler: ${handler.id}`);
  }
  handlers.set(handler.id, handler);
}

/**
 * 批量注册代码处理器
 */
export function registerCodeHandlers(list: CodeHandler[]): void {
  for (const handler of list) {
    registerCodeHandler(handler);
  }
}

/**
 * 按 ID 获取代码处理器
 */
export function getCodeHandler(id: string): CodeHandler | undefined {
  return handlers.get(id);
}

/**
 * 列出所有已注册的代码处理器
 */
export function listCodeHandlers(): CodeHandler[] {
  return Array.from(handlers.values());
}

/**
 * 移除一个代码处理器
 */
export function removeCodeHandler(id: string): boolean {
  return handlers.delete(id);
}

/**
 * 清空所有处理器（仅测试用）
 */
export function clearCodeHandlersForTests(): void {
  handlers.clear();
}
