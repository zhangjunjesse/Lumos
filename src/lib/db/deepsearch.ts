import crypto from 'crypto';
import type {
  DeepSearchArtifactKind,
  DeepSearchArtifactRecord,
  CreateDeepSearchRunInput,
  DeepSearchCookieStatus,
  DeepSearchRecord,
  DeepSearchRecordContentState,
  DeepSearchRecordFailureStage,
  DeepSearchRunAction,
  DeepSearchRunPageBinding,
  DeepSearchRunRecord,
  DeepSearchRunStatus,
  DeepSearchSiteLoginState,
  DeepSearchSiteRecord,
  DeepSearchSiteStateRecord,
  DeepSearchSiteUpsertInput,
} from '@/types';
import { getDb } from './connection';

interface DeepSearchSiteRow {
  id: string;
  site_key: string;
  display_name: string;
  base_url: string;
  cookie_value: string;
  cookie_status: DeepSearchCookieStatus;
  cookie_expires_at: string | null;
  last_validated_at: string | null;
  validation_message: string;
  notes: string;
  min_fetch_count: number;
  created_at: string;
  updated_at: string;
}

interface DeepSearchRunRow {
  id: string;
  query_text: string;
  site_keys_json: string;
  eligible_site_keys_json: string;
  blocked_site_keys_json: string;
  page_mode: DeepSearchRunRecord['pageMode'];
  strictness: DeepSearchRunRecord['strictness'];
  status: DeepSearchRunStatus;
  status_message: string;
  result_summary: string;
  detail_markdown: string;
  created_from: DeepSearchRunRecord['createdFrom'];
  requested_by_session_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface DeepSearchRunPageRow {
  id: string;
  run_id: string;
  page_id: string;
  site_key: string | null;
  binding_type: DeepSearchRunPageBinding['bindingType'];
  role: DeepSearchRunPageBinding['role'];
  initial_url: string | null;
  last_known_url: string | null;
  page_title: string | null;
  attached_at: string;
  released_at: string | null;
}

interface DeepSearchRecordRow {
  id: string;
  run_id: string;
  run_page_id: string | null;
  site_key: string | null;
  url: string;
  title: string;
  content_state: DeepSearchRecordContentState;
  snippet: string;
  evidence_count: number;
  failure_stage: DeepSearchRecordFailureStage | null;
  login_related: number;
  content_artifact_id: string | null;
  screenshot_artifact_id: string | null;
  error_message: string;
  fetched_at: string;
}

interface DeepSearchArtifactRow {
  id: string;
  run_id: string;
  record_id: string | null;
  kind: DeepSearchArtifactKind;
  title: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  metadata_json: string;
  created_at: string;
}

interface DeepSearchSiteStateRow {
  site_key: string;
  display_name: string;
  login_state: DeepSearchSiteLoginState;
  last_checked_at: string | null;
  last_login_at: string | null;
  blocking_reason: string;
  last_error: string;
  created_at: string;
  updated_at: string;
}

function normalizeTimestamp(value: Date = new Date()): string {
  return value.toISOString().replace('T', ' ').split('.')[0];
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function maskCookie(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= 12) {
    return `${trimmed.slice(0, 4)}...`;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function mapSiteStateRow(row: DeepSearchSiteStateRow): DeepSearchSiteStateRecord {
  return {
    siteKey: row.site_key,
    displayName: row.display_name,
    loginState: row.login_state,
    lastCheckedAt: row.last_checked_at,
    lastLoginAt: row.last_login_at,
    blockingReason: row.blocking_reason,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSiteRow(row: DeepSearchSiteRow, liveState: DeepSearchSiteStateRecord | null = null): DeepSearchSiteRecord {
  return {
    id: row.id,
    siteKey: row.site_key,
    displayName: row.display_name,
    baseUrl: row.base_url,
    cookieStatus: row.cookie_status,
    hasCookie: row.cookie_value.trim().length > 0,
    cookiePreview: maskCookie(row.cookie_value),
    cookieExpiresAt: row.cookie_expires_at,
    lastValidatedAt: row.last_validated_at,
    validationMessage: row.validation_message,
    notes: row.notes,
    minFetchCount: row.min_fetch_count ?? 3,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    liveState,
  };
}

function mapRunPageRow(row: DeepSearchRunPageRow): DeepSearchRunPageBinding {
  return {
    id: row.id,
    runId: row.run_id,
    pageId: row.page_id,
    siteKey: row.site_key,
    bindingType: row.binding_type,
    role: row.role,
    initialUrl: row.initial_url,
    lastKnownUrl: row.last_known_url,
    pageTitle: row.page_title,
    attachedAt: row.attached_at,
    releasedAt: row.released_at,
  };
}

function mapArtifactRow(row: DeepSearchArtifactRow): DeepSearchArtifactRecord {
  return {
    id: row.id,
    runId: row.run_id,
    recordId: row.record_id,
    kind: row.kind,
    title: row.title,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
  };
}

function mapRecordRow(row: DeepSearchRecordRow): DeepSearchRecord {
  return {
    id: row.id,
    runId: row.run_id,
    runPageId: row.run_page_id,
    siteKey: row.site_key,
    url: row.url,
    title: row.title,
    contentState: row.content_state,
    snippet: row.snippet,
    evidenceCount: row.evidence_count,
    failureStage: row.failure_stage,
    loginRelated: Boolean(row.login_related),
    contentArtifactId: row.content_artifact_id,
    screenshotArtifactId: row.screenshot_artifact_id,
    errorMessage: row.error_message,
    fetchedAt: row.fetched_at,
    contentArtifact: null,
    screenshotArtifact: null,
    artifacts: [],
  };
}

function attachArtifactsToRecords(
  records: DeepSearchRecord[],
  artifacts: DeepSearchArtifactRecord[],
): DeepSearchRecord[] {
  if (records.length === 0) {
    return records;
  }

  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const artifactsByRecordId = new Map<string, DeepSearchArtifactRecord[]>();
  for (const artifact of artifacts) {
    if (!artifact.recordId) {
      continue;
    }
    const current = artifactsByRecordId.get(artifact.recordId);
    if (current) {
      current.push(artifact);
      continue;
    }
    artifactsByRecordId.set(artifact.recordId, [artifact]);
  }

  return records.map((record) => {
    const recordArtifacts = artifactsByRecordId.get(record.id) ?? [];
    return {
      ...record,
      artifacts: recordArtifacts,
      contentArtifact: record.contentArtifactId ? (artifactsById.get(record.contentArtifactId) ?? null) : null,
      screenshotArtifact: record.screenshotArtifactId ? (artifactsById.get(record.screenshotArtifactId) ?? null) : null,
    };
  });
}

function mapRunRow(
  row: DeepSearchRunRow,
  pageBindings: DeepSearchRunPageBinding[] = [],
  records: DeepSearchRecord[] = [],
  artifacts: DeepSearchArtifactRecord[] = [],
): DeepSearchRunRecord {
  return {
    id: row.id,
    queryText: row.query_text,
    siteKeys: parseStringArray(row.site_keys_json),
    eligibleSiteKeys: parseStringArray(row.eligible_site_keys_json),
    blockedSiteKeys: parseStringArray(row.blocked_site_keys_json),
    pageMode: row.page_mode,
    strictness: row.strictness,
    status: row.status,
    statusMessage: row.status_message,
    resultSummary: row.result_summary,
    detailMarkdown: row.detail_markdown,
    createdFrom: row.created_from,
    requestedBySessionId: row.requested_by_session_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    pageBindings,
    records,
    artifacts,
  };
}

export function updateDeepSearchRunArchivedAt(id: string): void {
  getDb()
    .prepare("UPDATE deepsearch_runs SET archived_at = datetime('now') WHERE id = ?")
    .run(id);
}

function getRunPageBindingsByRunIds(runIds: string[]): Map<string, DeepSearchRunPageBinding[]> {
  const bindingsByRunId = new Map<string, DeepSearchRunPageBinding[]>();
  if (runIds.length === 0) {
    return bindingsByRunId;
  }

  const db = getDb();
  const placeholders = runIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT *
    FROM deepsearch_run_pages
    WHERE run_id IN (${placeholders})
    ORDER BY attached_at DESC, id DESC
  `).all(...runIds) as DeepSearchRunPageRow[];

  for (const row of rows) {
    const binding = mapRunPageRow(row);
    const current = bindingsByRunId.get(binding.runId);
    if (current) {
      current.push(binding);
      continue;
    }
    bindingsByRunId.set(binding.runId, [binding]);
  }

  return bindingsByRunId;
}

function getSiteStatesByKeys(siteKeys: string[]): Map<string, DeepSearchSiteStateRecord> {
  const statesBySiteKey = new Map<string, DeepSearchSiteStateRecord>();
  if (siteKeys.length === 0) {
    return statesBySiteKey;
  }

  const db = getDb();
  const placeholders = siteKeys.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT *
    FROM deepsearch_site_states
    WHERE site_key IN (${placeholders})
  `).all(...siteKeys) as DeepSearchSiteStateRow[];

  for (const row of rows) {
    const state = mapSiteStateRow(row);
    statesBySiteKey.set(state.siteKey, state);
  }

  return statesBySiteKey;
}

function getArtifactsByRunIds(runIds: string[]): Map<string, DeepSearchArtifactRecord[]> {
  const artifactsByRunId = new Map<string, DeepSearchArtifactRecord[]>();
  if (runIds.length === 0) {
    return artifactsByRunId;
  }

  const db = getDb();
  const placeholders = runIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT *
    FROM deepsearch_artifacts
    WHERE run_id IN (${placeholders})
    ORDER BY created_at ASC, id ASC
  `).all(...runIds) as DeepSearchArtifactRow[];

  for (const row of rows) {
    const artifact = mapArtifactRow(row);
    const current = artifactsByRunId.get(artifact.runId);
    if (current) {
      current.push(artifact);
      continue;
    }
    artifactsByRunId.set(artifact.runId, [artifact]);
  }

  return artifactsByRunId;
}

function getRecordsByRunIds(runIds: string[], artifactsByRunId?: Map<string, DeepSearchArtifactRecord[]>): Map<string, DeepSearchRecord[]> {
  const recordsByRunId = new Map<string, DeepSearchRecord[]>();
  if (runIds.length === 0) {
    return recordsByRunId;
  }

  const db = getDb();
  const placeholders = runIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT *
    FROM deepsearch_records
    WHERE run_id IN (${placeholders})
    ORDER BY fetched_at DESC, id DESC
  `).all(...runIds) as DeepSearchRecordRow[];

  for (const row of rows) {
    const record = mapRecordRow(row);
    const current = recordsByRunId.get(record.runId);
    if (current) {
      current.push(record);
      continue;
    }
    recordsByRunId.set(record.runId, [record]);
  }

  if (!artifactsByRunId) {
    return recordsByRunId;
  }

  for (const runId of runIds) {
    const records = recordsByRunId.get(runId);
    if (!records) {
      continue;
    }
    recordsByRunId.set(runId, attachArtifactsToRecords(records, artifactsByRunId.get(runId) ?? []));
  }

  return recordsByRunId;
}

function getSiteRowsByKeys(siteKeys: string[]): DeepSearchSiteRow[] {
  const db = getDb();
  if (siteKeys.length === 0) {
    return [];
  }
  const placeholders = siteKeys.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM deepsearch_sites WHERE site_key IN (${placeholders})`).all(...siteKeys) as DeepSearchSiteRow[];
}

function getSiteNames(rows: DeepSearchSiteRow[], siteKeys: string[]): string[] {
  const names = new Map(rows.map((row) => [row.site_key, row.display_name]));
  return siteKeys.map((siteKey) => names.get(siteKey) ?? siteKey);
}

function isSiteReady(row: DeepSearchSiteRow, liveState?: DeepSearchSiteStateRecord | null): boolean {
  if (liveState) {
    return liveState.loginState === 'connected';
  }
  return row.cookie_status === 'valid';
}

function buildStatusDecision(
  rows: DeepSearchSiteRow[],
  strictness: DeepSearchRunRecord['strictness'],
  siteStates?: Map<string, DeepSearchSiteStateRecord>,
): Pick<DeepSearchRunRecord, 'status' | 'statusMessage' | 'resultSummary' | 'eligibleSiteKeys' | 'blockedSiteKeys'> {
  const eligibleSiteKeys = rows
    .filter((row) => isSiteReady(row, siteStates?.get(row.site_key) ?? null))
    .map((row) => row.site_key);
  const blockedSiteKeys = rows
    .filter((row) => !isSiteReady(row, siteStates?.get(row.site_key) ?? null))
    .map((row) => row.site_key);
  const blockedNames = getSiteNames(rows, blockedSiteKeys);

  if (eligibleSiteKeys.length === 0) {
    return {
      status: 'waiting_login',
      statusMessage: 'No selected site currently has a valid shared login state.',
      resultSummary: 'Waiting for site login before browser handoff.',
      eligibleSiteKeys,
      blockedSiteKeys,
    };
  }

  if (strictness === 'strict' && blockedSiteKeys.length > 0) {
    return {
      status: 'waiting_login',
      statusMessage: `Strict mode blocked by missing or invalid login state: ${blockedNames.join(', ')}`,
      resultSummary: 'Blocked before dispatch because at least one target site still needs login.',
      eligibleSiteKeys,
      blockedSiteKeys,
    };
  }

  if (blockedSiteKeys.length > 0) {
    return {
      status: 'pending',
      statusMessage: `Best-effort mode can start with ready sites first; blocked sites may end as partial: ${blockedNames.join(', ')}`,
      resultSummary: 'Ready for partial-tolerant dispatch once the runtime is connected.',
      eligibleSiteKeys,
      blockedSiteKeys,
    };
  }

  return {
    status: 'pending',
    statusMessage: 'All selected sites are login-ready and can be handed to the browser runtime.',
    resultSummary: 'Ready for browser runtime dispatch.',
    eligibleSiteKeys,
    blockedSiteKeys,
  };
}

function buildRunDetailMarkdown(params: {
  queryText: string;
  siteRows: DeepSearchSiteRow[];
  siteKeys: string[];
  pageMode: DeepSearchRunRecord['pageMode'];
  strictness: DeepSearchRunRecord['strictness'];
  status: DeepSearchRunStatus;
  statusMessage: string;
  resultSummary: string;
  eligibleSiteKeys: string[];
  blockedSiteKeys: string[];
  pageBindings?: DeepSearchRunPageBinding[];
  bindingNote?: string | null;
  executionMarkdown?: string | null;
}): string {
  const siteNameMap = new Map(params.siteRows.map((row) => [row.site_key, row.display_name]));
  const siteLines = params.siteKeys.map((siteKey) => {
    const row = params.siteRows.find((item) => item.site_key === siteKey);
    const label = siteNameMap.get(siteKey) ?? siteKey;
    const cookieStatus = row?.cookie_status ?? 'missing';
    return `- ${label} (${siteKey}) | cookie=${cookieStatus}`;
  }).join('\n');

  const eligibleLine = params.eligibleSiteKeys.length > 0
    ? params.eligibleSiteKeys.map((siteKey) => siteNameMap.get(siteKey) ?? siteKey).join(', ')
    : 'none';
  const blockedLine = params.blockedSiteKeys.length > 0
    ? params.blockedSiteKeys.map((siteKey) => siteNameMap.get(siteKey) ?? siteKey).join(', ')
    : 'none';
  const bindingLines = (params.pageBindings ?? []).map((binding) => {
    const siteLabel = binding.siteKey ? (siteNameMap.get(binding.siteKey) ?? binding.siteKey) : 'unmatched';
    return `- ${binding.pageTitle || binding.lastKnownUrl || binding.pageId} | pageId=${binding.pageId} | site=${siteLabel} | type=${binding.bindingType} | role=${binding.role}`;
  }).join('\n');
  const bindingSummary = bindingLines || '- none';
  const bindingNote = params.bindingNote?.trim() || (
    (params.pageBindings?.length ?? 0) > 0
      ? (params.pageMode === 'takeover_active_page'
        ? 'An active browser page has been captured for this run.'
        : 'Managed browser pages have been allocated for this run.')
      : (params.pageMode === 'takeover_active_page'
        ? 'No active browser page was captured when this run was created.'
        : 'A managed page will be allocated by the runtime when execution begins.')
  );

  return [
    '# DeepSearch Runtime Handoff',
    '',
    '## Query',
    params.queryText,
    '',
    '## Target Sites',
    siteLines,
    '',
    '## Dispatch Decision',
    `- status: ${params.status}`,
    `- pageMode: ${params.pageMode}`,
    `- strictness: ${params.strictness}`,
    `- eligibleSites: ${eligibleLine}`,
    `- blockedSites: ${blockedLine}`,
    '',
    '## Status Message',
    params.statusMessage,
    '',
    '## Result Summary',
    params.resultSummary,
    '',
    '## Page Bindings',
    bindingSummary,
    '',
    '## Binding Note',
    bindingNote,
    '',
    ...(params.executionMarkdown?.trim()
      ? [params.executionMarkdown.trim(), '']
      : []),
    '## Runtime Gap',
    'Structured records and artifacts are now persisted, but site adapters and stronger full-content extraction are still unfinished in this phase.',
  ].join('\n');
}

function applyRunPageBindingPatches(params: {
  runId: string;
  now: string;
  metadataPatches?: Array<{
    pageId: string;
    lastKnownUrl?: string | null;
    pageTitle?: string | null;
  }>;
  releaseBindings?: boolean;
}) {
  const db = getDb();

  for (const patch of params.metadataPatches ?? []) {
    db.prepare(`
      UPDATE deepsearch_run_pages
      SET last_known_url = COALESCE(?, last_known_url),
          page_title = COALESCE(?, page_title)
      WHERE run_id = ?
        AND page_id = ?
    `).run(
      normalizeOptionalText(patch.lastKnownUrl),
      normalizeOptionalText(patch.pageTitle),
      params.runId,
      patch.pageId,
    );
  }

  if (params.releaseBindings) {
    db.prepare(`
      UPDATE deepsearch_run_pages
      SET released_at = COALESCE(released_at, ?)
      WHERE run_id = ?
    `).run(params.now, params.runId);
  }
}

export function listDeepSearchSites(): DeepSearchSiteRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM deepsearch_sites ORDER BY display_name COLLATE NOCASE ASC').all() as DeepSearchSiteRow[];
  const statesBySiteKey = getSiteStatesByKeys(rows.map((row) => row.site_key));
  return rows.map((row) => mapSiteRow(row, statesBySiteKey.get(row.site_key) ?? null));
}

export function getDeepSearchSite(siteKey: string): DeepSearchSiteRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM deepsearch_sites WHERE site_key = ?').get(siteKey) as DeepSearchSiteRow | undefined;
  if (!row) {
    return null;
  }
  const statesBySiteKey = getSiteStatesByKeys([siteKey]);
  return mapSiteRow(row, statesBySiteKey.get(siteKey) ?? null);
}

export function getDeepSearchSiteCookieValue(siteKey: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT cookie_value FROM deepsearch_sites WHERE site_key = ?').get(siteKey) as
    | { cookie_value: string }
    | undefined;
  if (!row) {
    return null;
  }
  const value = row.cookie_value.trim();
  return value || null;
}

export function upsertDeepSearchSite(input: DeepSearchSiteUpsertInput): DeepSearchSiteRecord {
  const db = getDb();
  const now = normalizeTimestamp();
  const existing = db.prepare('SELECT * FROM deepsearch_sites WHERE site_key = ?').get(input.siteKey) as DeepSearchSiteRow | undefined;

  const nextCookieValue = input.cookieValue !== undefined
    ? (input.cookieValue ?? '').trim()
    : (existing?.cookie_value ?? '');
  const nextHasCookie = nextCookieValue.length > 0;
  const requestedStatus = input.cookieStatus ?? (nextHasCookie ? 'valid' : 'missing');
  const cookieStatus: DeepSearchCookieStatus = nextHasCookie ? requestedStatus : 'missing';
  const cookieExpiresAt = input.cookieExpiresAt !== undefined
    ? normalizeOptionalText(input.cookieExpiresAt)
    : (existing?.cookie_expires_at ?? null);
  const lastValidatedAt = input.lastValidatedAt !== undefined
    ? normalizeOptionalText(input.lastValidatedAt)
    : now;
  const validationMessage = input.validationMessage !== undefined
    ? input.validationMessage.trim()
    : (existing?.validation_message ?? '');
  const notes = input.notes !== undefined
    ? input.notes.trim()
    : (existing?.notes ?? '');
  const minFetchCount = input.minFetchCount !== undefined
    ? Math.max(1, Math.min(input.minFetchCount, 20))
    : (existing?.min_fetch_count ?? 3);
  const displayName = input.displayName?.trim() || existing?.display_name || input.siteKey;
  const baseUrl = input.baseUrl?.trim() || existing?.base_url || '';
  const id = existing?.id || `deepsearch-site-${input.siteKey}`;

  db.prepare(`
    INSERT INTO deepsearch_sites (
      id, site_key, display_name, base_url, cookie_value, cookie_status,
      cookie_expires_at, last_validated_at, validation_message, notes,
      min_fetch_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_key) DO UPDATE SET
      display_name = excluded.display_name,
      base_url = excluded.base_url,
      cookie_value = excluded.cookie_value,
      cookie_status = excluded.cookie_status,
      cookie_expires_at = excluded.cookie_expires_at,
      last_validated_at = excluded.last_validated_at,
      validation_message = excluded.validation_message,
      notes = excluded.notes,
      min_fetch_count = excluded.min_fetch_count,
      updated_at = excluded.updated_at
  `).run(
    id,
    input.siteKey,
    displayName,
    baseUrl,
    nextCookieValue,
    cookieStatus,
    cookieExpiresAt,
    lastValidatedAt,
    validationMessage,
    notes,
    minFetchCount,
    existing?.created_at ?? now,
    now,
  );

  const updated = getDeepSearchSite(input.siteKey);
  if (!updated) {
    throw new Error(`Failed to upsert DeepSearch site: ${input.siteKey}`);
  }
  return updated;
}

export function getDeepSearchSiteState(siteKey: string): DeepSearchSiteStateRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM deepsearch_site_states WHERE site_key = ?').get(siteKey) as DeepSearchSiteStateRow | undefined;
  return row ? mapSiteStateRow(row) : null;
}

export function upsertDeepSearchSiteState(input: {
  siteKey: string;
  displayName?: string;
  loginState: DeepSearchSiteLoginState;
  lastCheckedAt?: string | null;
  lastLoginAt?: string | null;
  blockingReason?: string;
  lastError?: string;
}): DeepSearchSiteStateRecord {
  const db = getDb();
  const now = normalizeTimestamp();
  const existing = db.prepare('SELECT * FROM deepsearch_site_states WHERE site_key = ?').get(input.siteKey) as DeepSearchSiteStateRow | undefined;
  const site = db.prepare('SELECT * FROM deepsearch_sites WHERE site_key = ?').get(input.siteKey) as DeepSearchSiteRow | undefined;
  if (!site) {
    throw new Error(`Unknown DeepSearch site: ${input.siteKey}`);
  }

  const displayName = input.displayName?.trim() || existing?.display_name || site.display_name;
  const lastCheckedAt = input.lastCheckedAt !== undefined
    ? normalizeOptionalText(input.lastCheckedAt)
    : now;
  const lastLoginAt = input.lastLoginAt !== undefined
    ? normalizeOptionalText(input.lastLoginAt)
    : (input.loginState === 'connected' ? now : existing?.last_login_at ?? null);
  const blockingReason = (input.blockingReason || '').trim();
  const lastError = (input.lastError || '').trim();

  db.prepare(`
    INSERT INTO deepsearch_site_states (
      site_key, display_name, login_state, last_checked_at, last_login_at,
      blocking_reason, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_key) DO UPDATE SET
      display_name = excluded.display_name,
      login_state = excluded.login_state,
      last_checked_at = excluded.last_checked_at,
      last_login_at = excluded.last_login_at,
      blocking_reason = excluded.blocking_reason,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run(
    input.siteKey,
    displayName,
    input.loginState,
    lastCheckedAt,
    lastLoginAt,
    blockingReason,
    lastError,
    existing?.created_at ?? now,
    now,
  );

  const updated = getDeepSearchSiteState(input.siteKey);
  if (!updated) {
    throw new Error(`Failed to upsert DeepSearch site state: ${input.siteKey}`);
  }
  return updated;
}

export function listDeepSearchRuns(limit = 50): DeepSearchRunRecord[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM deepsearch_runs
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ?
  `).all(limit) as DeepSearchRunRow[];
  const runIds = rows.map((row) => row.id);
  const bindingsByRunId = getRunPageBindingsByRunIds(runIds);
  const artifactsByRunId = getArtifactsByRunIds(runIds);
  const recordsByRunId = getRecordsByRunIds(runIds, artifactsByRunId);
  return rows.map((row) => mapRunRow(
    row,
    bindingsByRunId.get(row.id) ?? [],
    recordsByRunId.get(row.id) ?? [],
    artifactsByRunId.get(row.id) ?? [],
  ));
}

export function getDeepSearchRun(id: string): DeepSearchRunRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM deepsearch_runs WHERE id = ?').get(id) as DeepSearchRunRow | undefined;
  if (!row) {
    return null;
  }
  const bindingsByRunId = getRunPageBindingsByRunIds([id]);
  const artifactsByRunId = getArtifactsByRunIds([id]);
  const recordsByRunId = getRecordsByRunIds([id], artifactsByRunId);
  return mapRunRow(
    row,
    bindingsByRunId.get(id) ?? [],
    recordsByRunId.get(id) ?? [],
    artifactsByRunId.get(id) ?? [],
  );
}

export function deleteDeepSearchRun(id: string): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM deepsearch_runs WHERE id = ?').get(id) as { id: string } | undefined;
  if (!existing) return false;

  db.transaction(() => {
    db.prepare('DELETE FROM deepsearch_artifacts WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM deepsearch_records WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM deepsearch_run_pages WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM deepsearch_runs WHERE id = ?').run(id);
  })();
  return true;
}

export function getDeepSearchArtifact(id: string): DeepSearchArtifactRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM deepsearch_artifacts WHERE id = ?').get(id) as DeepSearchArtifactRow | undefined;
  return row ? mapArtifactRow(row) : null;
}

export function createDeepSearchRun(
  input: CreateDeepSearchRunInput,
  options?: {
    pageBindings?: Array<{
      pageId: string;
      siteKey?: string | null;
      bindingType: DeepSearchRunPageBinding['bindingType'];
      role?: DeepSearchRunPageBinding['role'];
      initialUrl?: string | null;
      lastKnownUrl?: string | null;
      pageTitle?: string | null;
      attachedAt?: string | null;
    }>;
    bindingNote?: string | null;
  },
): DeepSearchRunRecord {
  const db = getDb();
  const now = normalizeTimestamp();
  const siteKeys = Array.from(new Set(input.siteKeys.map((siteKey) => siteKey.trim()).filter(Boolean)));
  const siteRows = getSiteRowsByKeys(siteKeys);
  const siteStatesByKey = getSiteStatesByKeys(siteKeys);

  if (siteRows.length !== siteKeys.length) {
    const resolved = new Set(siteRows.map((row) => row.site_key));
    const missing = siteKeys.filter((siteKey) => !resolved.has(siteKey));
    throw new Error(`Unknown DeepSearch site(s): ${missing.join(', ')}`);
  }

  const decision = buildStatusDecision(siteRows, input.strictness, siteStatesByKey);
  const detailMarkdown = buildRunDetailMarkdown({
    queryText: input.queryText.trim(),
    siteRows,
    siteKeys,
    pageMode: input.pageMode,
    strictness: input.strictness,
    status: decision.status,
    statusMessage: decision.statusMessage,
    resultSummary: decision.resultSummary,
    eligibleSiteKeys: decision.eligibleSiteKeys,
    blockedSiteKeys: decision.blockedSiteKeys,
    pageBindings: (options?.pageBindings ?? []).map((binding, index) => ({
      id: `pending-${index}`,
      runId: 'pending',
      pageId: binding.pageId,
      siteKey: binding.siteKey ?? null,
      bindingType: binding.bindingType,
      role: binding.role ?? 'seed',
      initialUrl: binding.initialUrl ?? null,
      lastKnownUrl: binding.lastKnownUrl ?? null,
      pageTitle: binding.pageTitle ?? null,
      attachedAt: binding.attachedAt ?? now,
      releasedAt: null,
    })),
    bindingNote: options?.bindingNote ?? null,
    executionMarkdown: null,
  });

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO deepsearch_runs (
      id, query_text, site_keys_json, eligible_site_keys_json, blocked_site_keys_json,
      page_mode, strictness, status, status_message, result_summary, detail_markdown,
      created_from, requested_by_session_id, started_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.queryText.trim(),
    JSON.stringify(siteKeys),
    JSON.stringify(decision.eligibleSiteKeys),
    JSON.stringify(decision.blockedSiteKeys),
    input.pageMode,
    input.strictness,
    decision.status,
    decision.statusMessage,
    decision.resultSummary,
    detailMarkdown,
    input.createdFrom ?? 'extensions',
    input.requestedBySessionId ?? null,
    null,
    null,
    now,
    now,
  );

  const pageBindings = (options?.pageBindings ?? []).filter((binding) => binding.pageId.trim().length > 0);
  if (pageBindings.length > 0) {
    const insertBinding = db.prepare(`
      INSERT INTO deepsearch_run_pages (
        id, run_id, page_id, site_key, binding_type, role,
        initial_url, last_known_url, page_title, attached_at, released_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const binding of pageBindings) {
      insertBinding.run(
        crypto.randomUUID(),
        id,
        binding.pageId.trim(),
        normalizeOptionalText(binding.siteKey),
        binding.bindingType,
        binding.role ?? 'seed',
        normalizeOptionalText(binding.initialUrl),
        normalizeOptionalText(binding.lastKnownUrl),
        normalizeOptionalText(binding.pageTitle),
        binding.attachedAt ?? now,
        null,
      );
    }
  }

  const run = getDeepSearchRun(id);
  if (!run) {
    throw new Error(`Failed to create DeepSearch run: ${id}`);
  }
  return run;
}

export function applyDeepSearchRunAction(id: string, action: DeepSearchRunAction): DeepSearchRunRecord {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM deepsearch_runs WHERE id = ?').get(id) as DeepSearchRunRow | undefined;
  if (!existing) {
    throw new Error('DeepSearch run not found');
  }

  const siteKeys = parseStringArray(existing.site_keys_json);
  const siteRows = getSiteRowsByKeys(siteKeys);
  const siteStatesByKey = getSiteStatesByKeys(siteKeys);
  const existingBindingsByRunId = getRunPageBindingsByRunIds([id]);
  const existingBindings = existingBindingsByRunId.get(id) ?? [];
  const now = normalizeTimestamp();
  let nextStatus = existing.status;
  let nextStartedAt = existing.started_at;
  let nextCompletedAt = existing.completed_at;
  let nextDecision = buildStatusDecision(siteRows, existing.strictness, siteStatesByKey);

  if (action === 'pause') {
    if (['completed', 'partial', 'failed', 'cancelled'].includes(existing.status)) {
      throw new Error('Terminal DeepSearch run cannot be paused');
    }
    nextStatus = 'paused';
    nextDecision = {
      ...nextDecision,
      status: 'paused',
      statusMessage: 'Paused from the DeepSearch control panel.',
      resultSummary: existing.result_summary,
    };
  }

  if (action === 'resume') {
    if (!['pending', 'paused', 'waiting_login'].includes(existing.status)) {
      throw new Error('Only pending, paused, or waiting-login runs can be resumed');
    }
    nextStatus = nextDecision.status;
    nextDecision = {
      ...nextDecision,
      status: nextStatus,
      statusMessage: nextStatus === 'waiting_login'
        ? nextDecision.statusMessage
        : 'Run resumed and is ready for browser runtime dispatch.',
      resultSummary: nextStatus === 'waiting_login'
        ? nextDecision.resultSummary
        : 'Resumed and waiting for runtime dispatch.',
    };
    nextCompletedAt = null;
  }

  if (action === 'cancel') {
    if (existing.status === 'cancelled') {
      return getDeepSearchRun(id) ?? mapRunRow(existing);
    }
    if (['completed', 'partial', 'failed'].includes(existing.status)) {
      throw new Error('Terminal DeepSearch run cannot be cancelled');
    }
    nextStatus = 'cancelled';
    nextDecision = {
      ...nextDecision,
      status: 'cancelled',
      statusMessage: 'Cancelled from the DeepSearch control panel.',
      resultSummary: 'Run was cancelled before runtime execution.',
    };
    nextCompletedAt = now;
    applyRunPageBindingPatches({
      runId: id,
      now,
      releaseBindings: true,
    });
  }

  const detailMarkdown = buildRunDetailMarkdown({
    queryText: existing.query_text,
    siteRows,
    siteKeys,
    pageMode: existing.page_mode,
    strictness: existing.strictness,
    status: nextStatus,
    statusMessage: nextDecision.statusMessage,
    resultSummary: nextDecision.resultSummary,
    eligibleSiteKeys: nextDecision.eligibleSiteKeys,
    blockedSiteKeys: nextDecision.blockedSiteKeys,
    pageBindings: existingBindings,
    executionMarkdown: null,
  });

  db.prepare(`
    UPDATE deepsearch_runs
    SET eligible_site_keys_json = ?,
        blocked_site_keys_json = ?,
        status = ?,
        status_message = ?,
        result_summary = ?,
        detail_markdown = ?,
        started_at = ?,
        completed_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(nextDecision.eligibleSiteKeys),
    JSON.stringify(nextDecision.blockedSiteKeys),
    nextStatus,
    nextDecision.statusMessage,
    nextDecision.resultSummary,
    detailMarkdown,
    nextStartedAt,
    nextCompletedAt,
    now,
    id,
  );

  const updated = getDeepSearchRun(id);
  if (!updated) {
    throw new Error('Failed to update DeepSearch run');
  }
  return updated;
}

export function appendDeepSearchRunPageBindings(
  runId: string,
  pageBindings: Array<{
    pageId: string;
    siteKey?: string | null;
    bindingType: DeepSearchRunPageBinding['bindingType'];
    role?: DeepSearchRunPageBinding['role'];
    initialUrl?: string | null;
    lastKnownUrl?: string | null;
    pageTitle?: string | null;
    attachedAt?: string | null;
  }>,
): DeepSearchRunRecord {
  const db = getDb();
  const now = normalizeTimestamp();
  const insertBinding = db.prepare(`
    INSERT INTO deepsearch_run_pages (
      id, run_id, page_id, site_key, binding_type, role,
      initial_url, last_known_url, page_title, attached_at, released_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const binding of pageBindings) {
    const pageId = binding.pageId.trim();
    if (!pageId) {
      continue;
    }
    insertBinding.run(
      crypto.randomUUID(),
      runId,
      pageId,
      normalizeOptionalText(binding.siteKey),
      binding.bindingType,
      binding.role ?? 'seed',
      normalizeOptionalText(binding.initialUrl),
      normalizeOptionalText(binding.lastKnownUrl),
      normalizeOptionalText(binding.pageTitle),
      binding.attachedAt ?? now,
      null,
    );
  }

  const run = getDeepSearchRun(runId);
  if (!run) {
    throw new Error('DeepSearch run not found');
  }
  return run;
}

export function replaceDeepSearchRunPageBindings(
  runId: string,
  pageBindings: Array<{
    pageId: string;
    siteKey?: string | null;
    bindingType: DeepSearchRunPageBinding['bindingType'];
    role?: DeepSearchRunPageBinding['role'];
    initialUrl?: string | null;
    lastKnownUrl?: string | null;
    pageTitle?: string | null;
    attachedAt?: string | null;
  }>,
): DeepSearchRunRecord {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM deepsearch_runs WHERE id = ?').get(runId) as { id: string } | undefined;
  if (!existing) {
    throw new Error('DeepSearch run not found');
  }

  const now = normalizeTimestamp();
  db.prepare(`
    UPDATE deepsearch_run_pages
    SET released_at = COALESCE(released_at, ?)
    WHERE run_id = ?
      AND released_at IS NULL
  `).run(now, runId);

  const insertBinding = db.prepare(`
    INSERT INTO deepsearch_run_pages (
      id, run_id, page_id, site_key, binding_type, role,
      initial_url, last_known_url, page_title, attached_at, released_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const binding of pageBindings) {
    const pageId = binding.pageId.trim();
    if (!pageId) {
      continue;
    }

    insertBinding.run(
      crypto.randomUUID(),
      runId,
      pageId,
      normalizeOptionalText(binding.siteKey),
      binding.bindingType,
      binding.role ?? 'seed',
      normalizeOptionalText(binding.initialUrl),
      normalizeOptionalText(binding.lastKnownUrl),
      normalizeOptionalText(binding.pageTitle),
      binding.attachedAt ?? now,
      null,
    );
  }

  const run = getDeepSearchRun(runId);
  if (!run) {
    throw new Error('DeepSearch run not found');
  }
  return run;
}

export function replaceDeepSearchRunResults(params: {
  runId: string;
  records: Array<{
    id: string;
    runPageId?: string | null;
    siteKey?: string | null;
    url?: string | null;
    title?: string | null;
    contentState: DeepSearchRecordContentState;
    snippet?: string | null;
    evidenceCount?: number;
    failureStage?: DeepSearchRecordFailureStage | null;
    loginRelated?: boolean;
    contentArtifactId?: string | null;
    screenshotArtifactId?: string | null;
    errorMessage?: string | null;
    fetchedAt?: string | null;
  }>;
  artifacts: Array<{
    id: string;
    recordId?: string | null;
    kind: DeepSearchArtifactKind;
    title?: string | null;
    storagePath: string;
    mimeType: string;
    sizeBytes?: number;
    metadata?: Record<string, unknown> | null;
    createdAt?: string | null;
  }>;
}) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM deepsearch_runs WHERE id = ?').get(params.runId) as { id: string } | undefined;
  if (!existing) {
    throw new Error('DeepSearch run not found');
  }

  db.prepare('DELETE FROM deepsearch_artifacts WHERE run_id = ?').run(params.runId);
  db.prepare('DELETE FROM deepsearch_records WHERE run_id = ?').run(params.runId);

  const now = normalizeTimestamp();
  const insertRecord = db.prepare(`
    INSERT INTO deepsearch_records (
      id, run_id, run_page_id, site_key, url, title, content_state, snippet,
      evidence_count, failure_stage, login_related, content_artifact_id,
      screenshot_artifact_id, error_message, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertArtifact = db.prepare(`
    INSERT INTO deepsearch_artifacts (
      id, run_id, record_id, kind, title, storage_path, mime_type,
      size_bytes, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const record of params.records) {
    insertRecord.run(
      record.id,
      params.runId,
      normalizeOptionalText(record.runPageId),
      normalizeOptionalText(record.siteKey),
      normalizeOptionalText(record.url) ?? '',
      normalizeOptionalText(record.title) ?? '',
      record.contentState,
      normalizeOptionalText(record.snippet) ?? '',
      Math.max(0, Math.floor(record.evidenceCount ?? 0)),
      record.failureStage ?? null,
      record.loginRelated ? 1 : 0,
      normalizeOptionalText(record.contentArtifactId),
      normalizeOptionalText(record.screenshotArtifactId),
      normalizeOptionalText(record.errorMessage) ?? '',
      record.fetchedAt ?? now,
    );
  }

  for (const artifact of params.artifacts) {
    insertArtifact.run(
      artifact.id,
      params.runId,
      normalizeOptionalText(artifact.recordId),
      artifact.kind,
      normalizeOptionalText(artifact.title) ?? '',
      artifact.storagePath.trim(),
      artifact.mimeType.trim(),
      Math.max(0, Math.floor(artifact.sizeBytes ?? 0)),
      JSON.stringify(artifact.metadata ?? {}),
      artifact.createdAt ?? now,
    );
  }

  const run = getDeepSearchRun(params.runId);
  if (!run) {
    throw new Error('DeepSearch run not found');
  }
  return run;
}

export function appendDeepSearchRunResult(params: {
  runId: string;
  record: {
    id: string;
    runPageId?: string | null;
    siteKey?: string | null;
    url?: string | null;
    title?: string | null;
    contentState: DeepSearchRecordContentState;
    snippet?: string | null;
    evidenceCount?: number;
    failureStage?: DeepSearchRecordFailureStage | null;
    loginRelated?: boolean;
    contentArtifactId?: string | null;
    screenshotArtifactId?: string | null;
    errorMessage?: string | null;
    fetchedAt?: string | null;
  };
  artifacts: Array<{
    id: string;
    recordId?: string | null;
    kind: DeepSearchArtifactKind;
    title?: string | null;
    storagePath: string;
    mimeType: string;
    sizeBytes?: number;
    metadata?: Record<string, unknown> | null;
    createdAt?: string | null;
  }>;
}): void {
  const db = getDb();
  const now = normalizeTimestamp();
  const { record } = params;

  db.prepare(`
    INSERT OR REPLACE INTO deepsearch_records (
      id, run_id, run_page_id, site_key, url, title, content_state, snippet,
      evidence_count, failure_stage, login_related, content_artifact_id,
      screenshot_artifact_id, error_message, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, params.runId,
    normalizeOptionalText(record.runPageId),
    normalizeOptionalText(record.siteKey),
    normalizeOptionalText(record.url) ?? '',
    normalizeOptionalText(record.title) ?? '',
    record.contentState,
    normalizeOptionalText(record.snippet) ?? '',
    Math.max(0, Math.floor(record.evidenceCount ?? 0)),
    record.failureStage ?? null,
    record.loginRelated ? 1 : 0,
    normalizeOptionalText(record.contentArtifactId),
    normalizeOptionalText(record.screenshotArtifactId),
    normalizeOptionalText(record.errorMessage) ?? '',
    record.fetchedAt ?? now,
  );

  const insertArtifact = db.prepare(`
    INSERT OR REPLACE INTO deepsearch_artifacts (
      id, run_id, record_id, kind, title, storage_path, mime_type,
      size_bytes, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const artifact of params.artifacts) {
    insertArtifact.run(
      artifact.id, params.runId,
      normalizeOptionalText(artifact.recordId),
      artifact.kind,
      normalizeOptionalText(artifact.title) ?? '',
      artifact.storagePath.trim(),
      artifact.mimeType.trim(),
      Math.max(0, Math.floor(artifact.sizeBytes ?? 0)),
      JSON.stringify(artifact.metadata ?? {}),
      artifact.createdAt ?? now,
    );
  }
}

export function updateDeepSearchRunExecution(params: {
  id: string;
  status: DeepSearchRunStatus;
  statusMessage: string;
  resultSummary: string;
  executionMarkdown?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  releaseBindings?: boolean;
  pageBindingMetadata?: Array<{
    pageId: string;
    lastKnownUrl?: string | null;
    pageTitle?: string | null;
  }>;
  eligibleSiteKeys?: string[];
  blockedSiteKeys?: string[];
}): DeepSearchRunRecord {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM deepsearch_runs WHERE id = ?').get(params.id) as DeepSearchRunRow | undefined;
  if (!existing) {
    throw new Error('DeepSearch run not found');
  }

  const siteKeys = parseStringArray(existing.site_keys_json);
  const siteRows = getSiteRowsByKeys(siteKeys);
  const now = normalizeTimestamp();
  applyRunPageBindingPatches({
    runId: params.id,
    now,
    metadataPatches: params.pageBindingMetadata,
    releaseBindings: params.releaseBindings,
  });

  const existingBindingsByRunId = getRunPageBindingsByRunIds([params.id]);
  const bindings = existingBindingsByRunId.get(params.id) ?? [];
  const detailMarkdown = buildRunDetailMarkdown({
    queryText: existing.query_text,
    siteRows,
    siteKeys,
    pageMode: existing.page_mode,
    strictness: existing.strictness,
    status: params.status,
    statusMessage: params.statusMessage,
    resultSummary: params.resultSummary,
    eligibleSiteKeys: params.eligibleSiteKeys ?? parseStringArray(existing.eligible_site_keys_json),
    blockedSiteKeys: params.blockedSiteKeys ?? parseStringArray(existing.blocked_site_keys_json),
    pageBindings: bindings,
    executionMarkdown: params.executionMarkdown ?? null,
  });

  db.prepare(`
    UPDATE deepsearch_runs
    SET eligible_site_keys_json = ?,
        blocked_site_keys_json = ?,
        status = ?,
        status_message = ?,
        result_summary = ?,
        detail_markdown = ?,
        started_at = ?,
        completed_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(params.eligibleSiteKeys ?? parseStringArray(existing.eligible_site_keys_json)),
    JSON.stringify(params.blockedSiteKeys ?? parseStringArray(existing.blocked_site_keys_json)),
    params.status,
    params.statusMessage,
    params.resultSummary,
    detailMarkdown,
    params.startedAt ?? existing.started_at,
    params.completedAt ?? existing.completed_at,
    now,
    params.id,
  );

  const updated = getDeepSearchRun(params.id);
  if (!updated) {
    throw new Error('Failed to update DeepSearch run execution');
  }
  return updated;
}
