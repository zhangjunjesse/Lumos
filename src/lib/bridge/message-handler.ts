import { getInboundPipeline, type FeishuWebhookMessage } from './core/inbound-pipeline';
import type { BridgeEventTransportKind } from './storage/bridge-event-repo';

export type { FeishuWebhookMessage };

export async function handleFeishuMessage(
  message: FeishuWebhookMessage,
  options?: { transportKind?: BridgeEventTransportKind },
) {
  const pipeline = getInboundPipeline();
  await pipeline.handleFeishuMessage(message, options);
}
