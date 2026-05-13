import { createSession, getAllSessions } from '@/lib/db';
import { isMainAgentSession, withSessionEntryMarker } from './session-entry';
import type { ChatSession } from '@/types';

const MAIN_AGENT_SESSION_TITLE = 'Lumos 主 Agent';

/**
 * Generic resolver for the Lumos Main Agent session.
 *
 * This is the system-wide chat that owns inbound IM traffic and that built-in
 * apps (WeChat Assistant, etc.) should push notifications/reports back into.
 * Marker lives in `session-entry.ts` (`__LUMOS_MAIN_AGENT__`) and is provider
 * agnostic — the wechat-specific wrapper in `lib/im/providers/wechat/` just
 * delegates here.
 */
export function resolveMainAgentSession(
  options: { createIfMissing?: boolean } = {},
): ChatSession | null {
  const main = getAllSessions().find((session) => isMainAgentSession(session));
  if (main) return main;
  if (!options.createIfMissing) return null;
  return createSession(
    MAIN_AGENT_SESSION_TITLE,
    undefined,
    withSessionEntryMarker(undefined, 'main-agent'),
  );
}
