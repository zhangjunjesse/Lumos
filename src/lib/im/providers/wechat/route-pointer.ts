/**
 * WeChat Route Pointer
 *
 * 当前 wechat 入站消息路由到哪个 lumos session（全局单值）。
 * 用户在微信里发 /switch 切换，重启后保留。
 *
 * 存储：settings 表 key = 'im.wechat.current_session_id'
 * 失效降级：指针指向已删除 session → 调用方需要重新建并 set。
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
