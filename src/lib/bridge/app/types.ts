import type { BridgeTransportStatus } from '../storage/bridge-connection-repo';

export type BridgeAuthStatus = 'ok' | 'missing' | 'expired' | 'revoked';
export type BridgePipelineStatus = 'healthy' | 'degraded' | 'failing';
export type BridgeHealthBindingStatus = 'pending' | 'active' | 'paused' | 'expired' | 'deleted';

export interface BridgeHealthBindingView {
  bindingId: number;
  platform: string;
  channelId: string;
  channelName?: string;
  bindingStatus: BridgeHealthBindingStatus;
  authStatus: BridgeAuthStatus;
  transportStatus: BridgeTransportStatus;
  pipelineStatus: BridgePipelineStatus;
  lastInboundEventAt: number | null;
  lastInboundSuccessAt: number | null;
  lastInboundFailureAt: number | null;
  lastOutboundSuccessAt: number | null;
  lastOutboundFailureAt: number | null;
  consecutiveInboundFailures: number;
  consecutiveOutboundFailures: number;
  latestRetryableInboundEventId: string | null;
  latestRetryableInboundError: string | null;
  summary: string;
}

export interface BridgeHealthView {
  sessionId: string;
  bindings: BridgeHealthBindingView[];
}
