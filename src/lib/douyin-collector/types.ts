import type { CREATOR_CADENCES, KEYWORD_TIME_WINDOWS, JOB_KINDS, JOB_STATUSES } from './constants';

export type CreatorCadence = (typeof CREATOR_CADENCES)[number];
export type KeywordTimeWindow = (typeof KEYWORD_TIME_WINDOWS)[number];
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

// Index signatures so these record types satisfy the
// `Record<string, unknown>` constraint of the AppDataStore generics.
export interface CreatorRecord {
  [key: string]: unknown;
  sec_uid?: string | null;
  uid?: string | null;
  nickname: string;
  avatar?: string | null;
  follow_count?: number | null;
  cadence: CreatorCadence;
  last_checked_at?: string | null;
  last_failure_reason?: string | null;
  enabled: boolean;
  updated_at?: string;
}

export interface KeywordRecord {
  [key: string]: unknown;
  query: string;
  time_window: KeywordTimeWindow;
  dedupe_window_days: number;
  cadence: CreatorCadence;
  last_checked_at?: string | null;
  last_failure_reason?: string | null;
  enabled: boolean;
  updated_at?: string;
}

export interface CollectJobRecord {
  [key: string]: unknown;
  kind: JobKind;
  target_ref: string;
  status: JobStatus;
  started_at?: string | null;
  ended_at?: string | null;
  failure_reason?: string | null;
  discovered_count: number;
  transcribed_count: number;
  updated_at?: string;
}
