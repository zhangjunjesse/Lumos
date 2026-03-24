/**
 * 飞书同步功能类型定义
 */

export type BindingStatus = 'pending' | 'active' | 'inactive' | 'expired';
export type BindingBadgeStatus = BindingStatus | 'degraded' | 'failing';

export interface Binding {
  id: number;
  session_id: string;
  platform: string;
  platform_chat_id: string;
  platform_chat_name?: string;
  status: BindingStatus;
  share_link?: string;
  created_at: number;
  updated_at: number;
}

export interface SyncStats {
  totalMessages: number;
  successCount: number;
  failedCount: number;
  lastSyncAt: number | null;
}

export interface BridgeHealthBinding {
  bindingId: number;
  platform: string;
  channelId: string;
  channelName?: string;
  bindingStatus: 'pending' | 'active' | 'paused' | 'expired' | 'deleted';
  authStatus: 'ok' | 'missing' | 'expired' | 'revoked';
  transportStatus: 'starting' | 'connected' | 'reconnecting' | 'disconnected' | 'stale';
  pipelineStatus: 'healthy' | 'degraded' | 'failing';
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
  bindings: BridgeHealthBinding[];
}

export interface CreateBindingResponse {
  success: boolean;
  binding: Binding;
  shareLink: string;
}

export interface GetBindingResponse {
  binding: Binding | null;
}

export interface UpdateBindingResponse {
  success: boolean;
  binding: Binding;
}

export interface GetStatsResponse {
  stats: SyncStats;
}

export interface ErrorResponse {
  error: string;
  code: string;
}
