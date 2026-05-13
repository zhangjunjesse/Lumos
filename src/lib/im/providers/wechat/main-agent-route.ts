import { resolveMainAgentSession } from '@/lib/chat/main-agent-session';
import type { ChatSession } from '@/types';

/**
 * Product rule: external WeChat IM entry belongs to the Main Agent.
 * Older route-pointer state may still exist for migration/debugging, but it
 * must not decide where inbound user messages land. Resolution is delegated
 * to the generic `resolveMainAgentSession` helper.
 */
export function resolveWechatMainAgentSession(
  options: { createIfMissing?: boolean } = {},
): ChatSession | null {
  return resolveMainAgentSession(options);
}
