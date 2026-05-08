import { createSession, getAllSessions } from '@/lib/db';
import { isMainAgentSession, withSessionEntryMarker } from '@/lib/chat/session-entry';
import type { ChatSession } from '@/types';

const WECHAT_MAIN_AGENT_SESSION_TITLE = 'Lumos 主 Agent';

/**
 * Product rule: external WeChat IM entry belongs to the Main Agent.
 * Older route-pointer state may still exist for migration/debugging, but it
 * must not decide where inbound user messages land.
 */
export function resolveWechatMainAgentSession(options: { createIfMissing?: boolean } = {}): ChatSession | null {
  const main = getAllSessions().find((session) => isMainAgentSession(session));
  if (main) return main;
  if (!options.createIfMissing) return null;

  return createSession(
    WECHAT_MAIN_AGENT_SESSION_TITLE,
    undefined,
    withSessionEntryMarker(undefined, 'main-agent'),
  );
}
