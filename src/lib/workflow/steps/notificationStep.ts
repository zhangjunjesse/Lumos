import { addMessage } from '@/lib/db';
import type { NotificationStepInput, StepResult } from '../types';

function buildAssistantMessage(text: string): string {
  return JSON.stringify([{ type: 'text', text }]);
}

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
