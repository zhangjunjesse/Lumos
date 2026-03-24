import { isFeishuConfigured } from '@/lib/feishu-config';
import { requireActiveFeishuUserAuth } from '../feishu-auth-guard';
import type { BindingService, BridgeBindingRecord } from '../core/binding-service';
import { getBridgeConnection, type BridgeConnectionRecord } from '../storage/bridge-connection-repo';
import {
  STALE_INBOUND_PROCESSING_MS,
  STALE_INBOUND_RECEIVED_MS,
} from '../core/inbound-pipeline-constants';
import { getLatestRecoverableInboundEvent } from '../storage/bridge-event-repo';
import type {
  BridgeAuthStatus,
  BridgeHealthBindingStatus,
  BridgeHealthBindingView,
  BridgeHealthView,
  BridgePipelineStatus,
} from './types';

const BRIDGE_RUNTIME_STALE_MS = 45_000;

function mapBindingStatus(status: BridgeBindingRecord['status']): BridgeHealthBindingStatus {
  if (status === 'inactive') return 'paused';
  return status;
}

function resolveFeishuAuthStatus(): BridgeAuthStatus {
  if (!isFeishuConfigured()) return 'missing';
  const auth = requireActiveFeishuUserAuth();
  if (auth.ok) return 'ok';
  if (auth.code === 'FEISHU_AUTH_EXPIRED') return 'expired';
  if (auth.code === 'FEISHU_AUTH_REQUIRED') return 'missing';
  return 'revoked';
}

function deriveTransportStatus(
  binding: BridgeBindingRecord,
  connection: BridgeConnectionRecord | null,
): BridgeHealthBindingView['transportStatus'] {
  if (binding.status === 'inactive') return 'disconnected';
  if (binding.status === 'expired') return 'disconnected';
  if (!connection) return 'disconnected';
  if (
    connection.status === 'connected'
    && Date.now() - connection.updated_at > BRIDGE_RUNTIME_STALE_MS
  ) {
    return 'stale';
  }
  return connection.status;
}

function derivePipelineStatus(params: {
  binding: BridgeBindingRecord;
  authStatus: BridgeAuthStatus;
  transportStatus: BridgeHealthBindingView['transportStatus'];
  hasRecentTransportError: boolean;
  lastInboundSuccessAt: number | null;
  lastInboundFailureAt: number | null;
  lastOutboundSuccessAt: number | null;
  lastOutboundFailureAt: number | null;
  consecutiveInboundFailures: number;
  consecutiveOutboundFailures: number;
  hasStaleInboundEvent: boolean;
}): BridgePipelineStatus {
  if (params.binding.status === 'expired' || params.authStatus !== 'ok') {
    return 'failing';
  }
  if (params.transportStatus === 'disconnected' || params.transportStatus === 'stale') {
    return 'failing';
  }
  if (params.hasRecentTransportError) {
    return 'failing';
  }
  if (params.hasStaleInboundEvent) {
    return 'failing';
  }
  if (params.consecutiveInboundFailures >= 3 || params.consecutiveOutboundFailures >= 3) {
    return 'degraded';
  }

  const hasRecentInboundFailure =
    params.lastInboundFailureAt !== null
    && (params.lastInboundSuccessAt === null || params.lastInboundFailureAt > params.lastInboundSuccessAt);
  const hasRecentOutboundFailure =
    params.lastOutboundFailureAt !== null
    && (params.lastOutboundSuccessAt === null || params.lastOutboundFailureAt > params.lastOutboundSuccessAt);

  if (hasRecentInboundFailure || hasRecentOutboundFailure) {
    return 'degraded';
  }
  return 'healthy';
}

function buildSummary(view: BridgeHealthBindingView): string {
  if (view.bindingStatus === 'pending') {
    return '已创建飞书群组，等待你扫码加入并确认开始同步';
  }
  if (view.bindingStatus === 'expired') {
    return view.authStatus === 'ok'
      ? '授权已恢复，等待同步状态刷新'
      : '登录失效，已暂停同步';
  }
  if (view.authStatus !== 'ok') return '账号未登录或授权已失效';
  if (view.transportStatus === 'starting') return '连接启动中';
  if (view.transportStatus === 'reconnecting') return '连接重建中';
  if (view.transportStatus === 'disconnected') return '连接未建立';
  if (view.transportStatus === 'stale') return '运行时心跳丢失，连接状态未知';
  if (view.pipelineStatus === 'degraded') return '最近存在同步失败';
  if (view.pipelineStatus === 'failing') return '同步链路异常';
  return '同步状态正常';
}

export class BridgeHealthService {
  constructor(private readonly bindingService: BindingService) {}

  getSessionHealth(sessionId: string): BridgeHealthView {
    const bindings = this.bindingService.listBindings(sessionId);

    const healthBindings = bindings.map((binding) => {
      const authStatus = binding.platform === 'feishu' ? resolveFeishuAuthStatus() : 'missing';
      const connection = getBridgeConnection(binding.platform, 'default', 'websocket');
      const syncSummary = this.bindingService.getSyncHealthSummary(binding.id);
      const latestRetryableInboundEvent = getLatestRecoverableInboundEvent(binding.id, {
        staleReceivedBefore: Date.now() - STALE_INBOUND_RECEIVED_MS,
        staleProcessingBefore: Date.now() - STALE_INBOUND_PROCESSING_MS,
      });
      const transportStatus = deriveTransportStatus(binding, connection);
      const lastInboundEventAt = connection?.last_event_at && connection.last_event_at >= binding.createdAt
        ? connection.last_event_at
        : null;
      const hasRecentTransportError = Boolean(
        connection?.last_error_at
        && connection.last_error_at >= binding.createdAt
        && (!connection.last_connected_at || connection.last_error_at >= connection.last_connected_at),
      );
      const hasStaleInboundEvent = Boolean(
        latestRetryableInboundEvent
        && (latestRetryableInboundEvent.status === 'received' || latestRetryableInboundEvent.status === 'processing')
        && (
          syncSummary.lastInboundSuccessAt === null
          || latestRetryableInboundEvent.updated_at > syncSummary.lastInboundSuccessAt
        ),
      );

      const view: BridgeHealthBindingView = {
        bindingId: binding.id,
        platform: binding.platform,
        channelId: binding.channelId,
        channelName: binding.channelName || undefined,
        bindingStatus: mapBindingStatus(binding.status),
        authStatus,
        transportStatus,
        pipelineStatus: derivePipelineStatus({
          binding,
          authStatus,
          transportStatus,
          hasRecentTransportError,
          lastInboundSuccessAt: syncSummary.lastInboundSuccessAt,
          lastInboundFailureAt: syncSummary.lastInboundFailureAt,
          lastOutboundSuccessAt: syncSummary.lastOutboundSuccessAt,
          lastOutboundFailureAt: syncSummary.lastOutboundFailureAt,
          consecutiveInboundFailures: syncSummary.consecutiveInboundFailures,
          consecutiveOutboundFailures: syncSummary.consecutiveOutboundFailures,
          hasStaleInboundEvent,
        }),
        lastInboundEventAt,
        lastInboundSuccessAt: syncSummary.lastInboundSuccessAt,
        lastInboundFailureAt: syncSummary.lastInboundFailureAt,
        lastOutboundSuccessAt: syncSummary.lastOutboundSuccessAt,
        lastOutboundFailureAt: syncSummary.lastOutboundFailureAt,
        consecutiveInboundFailures: syncSummary.consecutiveInboundFailures,
        consecutiveOutboundFailures: syncSummary.consecutiveOutboundFailures,
        latestRetryableInboundEventId: latestRetryableInboundEvent?.id ?? null,
        latestRetryableInboundError:
          latestRetryableInboundEvent?.error_message
          ?? (
            latestRetryableInboundEvent
            && (latestRetryableInboundEvent.status === 'received' || latestRetryableInboundEvent.status === 'processing')
              ? '飞书入站事件已接收，但处理链路中断，可直接重试。'
              : null
          ),
        summary: '',
      };

      view.summary = buildSummary(view);
      return view;
    });

    return {
      sessionId,
      bindings: healthBindings,
    };
  }
}
