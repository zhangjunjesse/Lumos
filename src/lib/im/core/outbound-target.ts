import { BindingService } from '@/lib/bridge/core/binding-service';
import { getDefaultUserImTarget } from '@/lib/app/im-bridge';

export interface ResolvedOutboundTarget {
  providerId: string;
  chatId: string;
  /** How the chat was resolved. */
  source: 'session-binding' | 'default-user-target';
}

/**
 * Decide which external chat a workflow notification should push to for a
 * given (sessionId, providerId).
 *
 * - feishu / generic providers: 1:1 session_bindings row from the bridge layer
 *   (created when the user explicitly binds a channel to a Lumos session).
 * - wechat: inbound never creates session_bindings; the bridge instead routes
 *   every wechat message into the single Main Agent and records the user's
 *   chat as the system-wide default IM target. We honour the same convention
 *   for outbound so app notifications and workflow notifications can reach the
 *   user without per-session bindings.
 */
export function resolveOutboundImTarget(
  sessionId: string,
  providerId: string,
): ResolvedOutboundTarget | null {
  if (sessionId) {
    const binding = new BindingService().getActiveBinding(sessionId, providerId);
    if (binding?.channelId) {
      return { providerId, chatId: binding.channelId, source: 'session-binding' };
    }
  }
  if (providerId === 'wechat') {
    const fallback = getDefaultUserImTarget();
    if (fallback && fallback.providerId === providerId && fallback.chatId) {
      return { providerId, chatId: fallback.chatId, source: 'default-user-target' };
    }
  }
  return null;
}
