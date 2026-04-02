import type {
  DeepSearchCookieStatus,
  DeepSearchPageMode,
  DeepSearchRecord,
  DeepSearchRunAction,
  DeepSearchRunRecord,
  DeepSearchRunStatus,
  DeepSearchSiteLoginState,
  DeepSearchSiteRecord,
  DeepSearchStrictness,
} from '@/types/deepsearch';

export type { DeepSearchCookieStatus, DeepSearchPageMode, DeepSearchRecord, DeepSearchRunAction, DeepSearchRunRecord, DeepSearchRunStatus, DeepSearchSiteLoginState, DeepSearchSiteRecord, DeepSearchStrictness };

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '-';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

export function getTimestampValue(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function buildArtifactUrl(artifactId: string): string {
  return `/api/deepsearch/artifacts/${encodeURIComponent(artifactId)}`;
}

export const ACTIVE_STATUSES: DeepSearchRunStatus[] = ['pending', 'running', 'waiting_login'];

export function getStatusVariant(status: DeepSearchRunStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'completed') return 'default';
  if (status === 'running' || status === 'partial') return 'secondary';
  if (status === 'failed' || status === 'cancelled') return 'destructive';
  return 'outline';
}

export function getLoginStateVariant(state: DeepSearchSiteLoginState): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (state === 'connected') return 'default';
  if (state === 'suspected_expired') return 'secondary';
  if (state === 'expired' || state === 'error') return 'destructive';
  return 'outline';
}

export function getCookieVariant(status: DeepSearchCookieStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'valid') return 'default';
  if (status === 'expired') return 'destructive';
  if (status === 'unknown') return 'secondary';
  return 'outline';
}
