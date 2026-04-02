export type DeepSearchCookieStatus = 'missing' | 'valid' | 'expired' | 'unknown';

export type DeepSearchRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_login'
  | 'paused'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type DeepSearchPageMode = 'takeover_active_page' | 'managed_page';
export type DeepSearchStrictness = 'strict' | 'best_effort';
export type DeepSearchRunSource = 'extensions' | 'chat' | 'workflow' | 'api';
export type DeepSearchRunAction = 'pause' | 'resume' | 'cancel';
export type DeepSearchRunPageBindingType = 'taken_over_active_page' | 'managed_page';
export type DeepSearchRunPageRole = 'seed' | 'search' | 'detail' | 'login';
export type DeepSearchSiteLoginState = 'missing' | 'connected' | 'suspected_expired' | 'expired' | 'error';
export type DeepSearchRecordContentState = 'list_only' | 'partial' | 'full' | 'failed';
export type DeepSearchRecordFailureStage = 'login' | 'navigation' | 'extraction' | 'normalization';
export type DeepSearchArtifactKind =
  | 'content'
  | 'screenshot'
  | 'structured_json'
  | 'evidence_snippet'
  | 'html_snapshot';
export type DeepSearchWaitingLoginRecoveryOutcomeType =
  | 'still_blocked'
  | 'resumed'
  | 'resume_failed'
  | 'skipped';

export interface DeepSearchBrowserPageSummary {
  pageId: string;
  url: string;
  title: string;
  isActive: boolean;
  isLoading: boolean;
}

export interface DeepSearchBrowserBindingPreview {
  pageMode: DeepSearchPageMode;
  runtimeAvailable: boolean;
  runtimeSource?: 'env' | 'runtime-file';
  canPrepare: boolean;
  reason?: string;
  note?: string;
  activePage: DeepSearchBrowserPageSummary | null;
  pages: DeepSearchBrowserPageSummary[];
}

export interface DeepSearchSiteRecord {
  id: string;
  siteKey: string;
  displayName: string;
  baseUrl: string;
  cookieStatus: DeepSearchCookieStatus;
  hasCookie: boolean;
  cookiePreview: string;
  cookieExpiresAt: string | null;
  lastValidatedAt: string | null;
  validationMessage: string;
  notes: string;
  minFetchCount: number;
  createdAt: string;
  updatedAt: string;
  liveState: DeepSearchSiteStateRecord | null;
}

export interface DeepSearchSiteStateRecord {
  siteKey: string;
  displayName: string;
  loginState: DeepSearchSiteLoginState;
  lastCheckedAt: string | null;
  lastLoginAt: string | null;
  blockingReason: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeepSearchSiteUpsertInput {
  siteKey: string;
  displayName?: string;
  baseUrl?: string;
  cookieValue?: string | null;
  cookieStatus?: DeepSearchCookieStatus;
  cookieExpiresAt?: string | null;
  lastValidatedAt?: string | null;
  validationMessage?: string;
  notes?: string;
  minFetchCount?: number;
}

export interface CreateDeepSearchRunInput {
  queryText: string;
  siteKeys: string[];
  pageMode: DeepSearchPageMode;
  strictness: DeepSearchStrictness;
  createdFrom?: DeepSearchRunSource;
  requestedBySessionId?: string | null;
}

export interface DeepSearchRunPageBinding {
  id: string;
  runId: string;
  pageId: string;
  siteKey: string | null;
  bindingType: DeepSearchRunPageBindingType;
  role: DeepSearchRunPageRole;
  initialUrl: string | null;
  lastKnownUrl: string | null;
  pageTitle: string | null;
  attachedAt: string;
  releasedAt: string | null;
}

export interface DeepSearchArtifactRecord {
  id: string;
  runId: string;
  recordId: string | null;
  kind: DeepSearchArtifactKind;
  title: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DeepSearchRecord {
  id: string;
  runId: string;
  runPageId: string | null;
  siteKey: string | null;
  url: string;
  title: string;
  contentState: DeepSearchRecordContentState;
  snippet: string;
  evidenceCount: number;
  failureStage: DeepSearchRecordFailureStage | null;
  loginRelated: boolean;
  contentArtifactId: string | null;
  screenshotArtifactId: string | null;
  errorMessage: string;
  fetchedAt: string;
  contentArtifact: DeepSearchArtifactRecord | null;
  screenshotArtifact: DeepSearchArtifactRecord | null;
  artifacts: DeepSearchArtifactRecord[];
}

export interface DeepSearchRunRecord {
  id: string;
  queryText: string;
  siteKeys: string[];
  eligibleSiteKeys: string[];
  blockedSiteKeys: string[];
  pageMode: DeepSearchPageMode;
  strictness: DeepSearchStrictness;
  status: DeepSearchRunStatus;
  statusMessage: string;
  resultSummary: string;
  detailMarkdown: string;
  createdFrom: DeepSearchRunSource;
  requestedBySessionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  pageBindings: DeepSearchRunPageBinding[];
  records: DeepSearchRecord[];
  artifacts: DeepSearchArtifactRecord[];
}

export interface DeepSearchWaitingLoginRecoveryOutcome {
  runId: string;
  outcome: DeepSearchWaitingLoginRecoveryOutcomeType;
  previousStatus: DeepSearchRunStatus;
  nextStatus: DeepSearchRunStatus;
  eligibleSiteKeys: string[];
  blockedSiteKeys: string[];
  message: string;
}

export interface DeepSearchWaitingLoginRecoveryResult {
  runs: DeepSearchRunRecord[];
  sites: DeepSearchSiteRecord[];
  checkedRunCount: number;
  resumedCount: number;
  waitingRunCount: number;
  outcomes: DeepSearchWaitingLoginRecoveryOutcome[];
}
