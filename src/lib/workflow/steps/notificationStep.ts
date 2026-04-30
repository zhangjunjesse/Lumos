import { addMessage } from '@/lib/db';
import {
  sendToProvider,
  getDefaultProviderId,
  hasProvider,
} from '@/lib/im';
import { BindingService } from '@/lib/bridge/core/binding-service';
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
  const sessionId = input.sessionId?.trim();
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

interface ImDeliveryArgs {
  message: string;
  level?: 'info' | 'warning' | 'error';
  channel: string;
  sessionId?: string;
  providerHint?: string;
}

/**
 * 解析 channel='im' 或 'im:<provider>' 路由：
 * - providerHint 指定具体 provider，否则用 default
 * - 通过 sessionId 在 session_bindings 找到对应 chat 进行投递
 */
async function deliverViaIm(args: ImDeliveryArgs): Promise<StepResult> {
  const providerId = args.providerHint || getDefaultProviderId();
  if (!providerId) {
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
      error: 'IM delivery requires sessionId so we can resolve the bound chat',
    };
  }

  const bindingService = new BindingService();
  const binding = bindingService.getActiveBinding(args.sessionId, providerId);
  if (!binding) {
    return {
      success: false,
      output: null,
      error: `No active ${providerId} binding for session ${args.sessionId}`,
    };
  }

  const result = await sendToProvider(providerId, {
    address: { providerId, chatId: binding.channelId },
    text: args.message,
  });

  if (!result.ok) {
    return {
      success: false,
      output: null,
      error: result.error || 'IM send failed',
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
      chatId: binding.channelId,
      messageId: result.messageId,
    },
    metadata: {
      deliveryMode: 'im',
    },
  };
}
