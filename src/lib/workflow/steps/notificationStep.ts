import { addMessage } from '@/lib/db';
import { resolveMainAgentSession } from '@/lib/chat/main-agent-session';
import {
  sendToProvider,
  getDefaultProviderId,
  hasProvider,
} from '@/lib/im';
import { resolveOutboundImTarget } from '@/lib/im/core/outbound-target';
import type { NotificationStepInput, StepResult } from '../types';

function buildAssistantMessage(text: string): string {
  return JSON.stringify([{ type: 'text', text }]);
}

const IM_CHANNEL_PATTERN = /^im(?::([a-z0-9_-]+))?$/i;

export async function notificationStep(input: NotificationStepInput): Promise<StepResult> {
  const message = input.message?.trim();
  if (!message) {
    return {
      success: false,
      output: null,
      error: 'Notification step message is required',
    };
  }

  const channel = (input.channel || 'system').trim() || 'system';
  const sessionId = resolveTargetSessionId(input);
  const imMatch = IM_CHANNEL_PATTERN.exec(channel);

  if (imMatch) {
    return deliverViaIm({ message, level: input.level, channel, sessionId, providerHint: imMatch[1] });
  }

  if (sessionId) {
    addMessage(sessionId, 'assistant', buildAssistantMessage(message));
    return {
      success: true,
      output: {
        message,
        channel,
        level: input.level || 'info',
        sessionId,
      },
      metadata: {
        deliveryMode: 'session-message',
      },
    };
  }

  return {
    success: true,
    output: {
      message,
      channel,
      level: input.level || 'info',
    },
    metadata: {
      deliveryMode: 'noop',
    },
  };
}

function resolveTargetSessionId(input: NotificationStepInput): string | undefined {
  if (input.targetSessionRef === 'main-agent') {
    const session = resolveMainAgentSession({ createIfMissing: true });
    if (session?.id) return session.id;
  }
  const sid = input.sessionId?.trim();
  return sid || undefined;
}

interface ImDeliveryArgs {
  message: string;
  level?: 'info' | 'warning' | 'error';
  channel: string;
  sessionId?: string;
  providerHint?: string;
}

/**
 * Dual delivery for `channel='im'` or `'im:<provider>'`:
 * - When `sessionId` is set, always append an assistant message to that
 *   session so the chat UI shows the notification regardless of IM binding.
 * - Then, if the session has an active IM binding for the resolved provider,
 *   push the same text out through the IM provider.
 *
 * Missing binding ≠ failure: we still report success with metadata so the
 * caller can tell the message landed in the session but did not go external.
 */
async function deliverViaIm(args: ImDeliveryArgs): Promise<StepResult> {
  const providerId = args.providerHint || getDefaultProviderId();
  if (!providerId) {
    if (args.sessionId) {
      addMessage(args.sessionId, 'assistant', buildAssistantMessage(args.message));
      return {
        success: true,
        output: { message: args.message, channel: args.channel, level: args.level || 'info', sessionId: args.sessionId },
        metadata: { deliveryMode: 'session-message', imDelivery: 'no-provider' },
      };
    }
    return {
      success: false,
      output: null,
      error: 'No IM provider available — set default in settings or use channel="im:<provider>"',
    };
  }
  if (!hasProvider(providerId)) {
    return { success: false, output: null, error: `Unknown IM provider: ${providerId}` };
  }
  if (!args.sessionId) {
    return {
      success: false,
      output: null,
      error: 'IM delivery requires sessionId (or targetSessionRef) so we can resolve the bound chat',
    };
  }

  addMessage(args.sessionId, 'assistant', buildAssistantMessage(args.message));

  const target = resolveOutboundImTarget(args.sessionId, providerId);
  if (!target) {
    return {
      success: true,
      output: {
        message: args.message,
        channel: args.channel,
        level: args.level || 'info',
        sessionId: args.sessionId,
        providerId,
      },
      metadata: {
        deliveryMode: 'session-message',
        imDelivery: 'no-binding',
      },
    };
  }

  const result = await sendToProvider(providerId, {
    address: { providerId, chatId: target.chatId },
    text: args.message,
  });

  if (!result.ok) {
    return {
      success: true,
      output: {
        message: args.message,
        channel: args.channel,
        level: args.level || 'info',
        sessionId: args.sessionId,
        providerId,
        chatId: target.chatId,
      },
      metadata: {
        deliveryMode: 'session-message',
        imDelivery: 'failed',
        imError: result.error || 'IM send failed',
        targetSource: target.source,
      },
    };
  }

  return {
    success: true,
    output: {
      message: args.message,
      channel: args.channel,
      level: args.level || 'info',
      sessionId: args.sessionId,
      providerId,
      chatId: target.chatId,
      messageId: result.messageId,
    },
    metadata: {
      deliveryMode: 'session+im',
      targetSource: target.source,
    },
  };
}
