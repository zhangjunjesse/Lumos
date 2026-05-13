import type { ApiProvider } from '@/types';

export type ProviderHealthStatus =
  | 'available'
  | 'upstream_rate_limited_or_unavailable'
  | 'quota_exhausted'
  | 'model_unavailable'
  | 'auth_failed'
  | 'gateway_unavailable'
  | 'timeout'
  | 'unknown_error';

export interface ProviderHealthResult {
  providerId: string;
  providerName?: string;
  model: string;
  status: ProviderHealthStatus;
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  requestId?: string;
  retryable: boolean;
  message: string;
  checkedAt: string;
  cached?: boolean;
}

export interface ProviderHealthClassification {
  status: ProviderHealthStatus;
  ok: boolean;
  retryable: boolean;
  message: string;
}

export interface RawProbeResult {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  requestId?: string;
  bodyText?: string;
  bodyJson?: unknown;
  error?: unknown;
  timedOut?: boolean;
}

export interface ProviderProbeInput {
  provider: ApiProvider;
  model: string;
  signal: AbortSignal;
}

export interface ProviderProbeAdapter {
  readonly name: string;
  canHandle(provider: ApiProvider): boolean;
  probe(input: ProviderProbeInput): Promise<RawProbeResult>;
}

export interface ProviderHealthCheckOptions {
  providerId: string;
  model?: string;
  force?: boolean;
}

