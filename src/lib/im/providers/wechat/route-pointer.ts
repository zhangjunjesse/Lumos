/**
 * WeChat Route Pointer
 *
 * Legacy WeChat route pointer.
 *
 * 存储：settings 表 key = 'im.wechat.current_session_id'
 *
 * 该值曾用于让微信入站消息切到任意 Lumos session。现在产品规则已经
 * 收敛为“微信入口固定进入主 Agent”，因此该指针只保留给旧 UI / 迁移 /
 * 调试状态使用，不再作为入站路由真源。
 */

import { getSetting, setSetting, getSession } from '@/lib/db';

const KEY = 'im.wechat.current_session_id';

/** Returns the session id pointer if it points to an existing session; else null. */
export function getCurrentRoutedSessionId(): string | null {
  const id = getSetting(KEY);
  if (!id || !id.trim()) return null;
  return getSession(id) ? id : null;
}

/** Returns the raw pointer value without validation (for debug / migrations). */
export function getRawRoutedSessionId(): string {
  return getSetting(KEY) || '';
}

export function setCurrentRoutedSessionId(sessionId: string): void {
  setSetting(KEY, sessionId);
}

export function clearCurrentRoutedSessionId(): void {
  setSetting(KEY, '');
}
