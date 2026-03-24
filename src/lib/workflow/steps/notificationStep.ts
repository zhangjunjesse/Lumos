import { randomUUID } from 'crypto';
import { addMessage } from '@/lib/db/sessions';
import type {
  NotificationStepInput,
  StepResult,
  WorkflowStepRuntimeContext,
} from '../types';

type NotificationDeliveryMode = 'feishu' | 'session-message' | 'console';

function getDefaultRuntimeContext(): WorkflowStepRuntimeContext {
  return {
    workflowRunId: `workflow-run-${randomUUID()}`,
    stepId: `notification-step-${randomUUID().slice(0, 8)}`,
    stepType: 'notification',
  };
}

function buildNotificationContent(input: NotificationStepInput): string {
  const level = (input.level ?? 'info').toUpperCase();
  return `[Workflow Notification][${level}] ${input.message}`;
}

function buildMetadata(
  runtimeContext: WorkflowStepRuntimeContext,
  deliveryMode: NotificationDeliveryMode,
): Record<string, string | null> {
  return {
    workflowRunId: runtimeContext.workflowRunId,
    stepId: runtimeContext.stepId,
    deliveryMode,
  };
}

async function deliverFeishuNotification(input: NotificationStepInput): Promise<{
  messageId: string | null;
}> {
  if (!input.sessionId) {
    throw new Error('notification.feishu requires sessionId');
  }

  const { getBridgeService } = await import('@/lib/bridge/app/bridge-service');
  const result = await getBridgeService().sendMessage({
    sessionId: input.sessionId,
    platform: 'feishu',
    mode: 'text',
    content: buildNotificationContent(input),
  });

  if (!result.ok) {
    throw new Error(result.error || 'FEISHU_SEND_FAILED');
  }

  return {
    messageId: result.messageId ?? null,
  };
}

function deliverSystemNotification(input: NotificationStepInput): {
  messageId: string | null;
  deliveryMode: NotificationDeliveryMode;
} {
  if (input.sessionId) {
    const message = addMessage(
      input.sessionId,
      'assistant',
      buildNotificationContent(input),
      null,
    );
    return {
      messageId: message.id,
      deliveryMode: 'session-message',
    };
  }

  const level = input.level || 'info';
  console.log(`[${level.toUpperCase()}] ${input.message}`);
  return {
    messageId: null,
    deliveryMode: 'console',
  };
}

export async function notificationStep(input: NotificationStepInput): Promise<StepResult> {
  const runtimeContext = input.__runtime ?? getDefaultRuntimeContext();
  const channel = input.channel ?? 'system';

  try {
    if (channel === 'feishu') {
      const delivered = await deliverFeishuNotification(input);
      return {
        success: true,
        output: {
          messageId: delivered.messageId,
          message: input.message,
          level: input.level ?? 'info',
          channel,
          sessionId: input.sessionId ?? null,
        },
        metadata: buildMetadata(runtimeContext, 'feishu'),
      };
    }

    if (channel === 'system') {
      const delivered = deliverSystemNotification(input);
      return {
        success: true,
        output: {
          messageId: delivered.messageId,
          message: input.message,
          level: input.level ?? 'info',
          channel,
          sessionId: input.sessionId ?? null,
        },
        metadata: buildMetadata(runtimeContext, delivered.deliveryMode),
      };
    }

    throw new Error(`Unsupported notification channel: ${channel}`);
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: buildMetadata(runtimeContext, channel === 'feishu' ? 'feishu' : 'console'),
    };
  }
}
