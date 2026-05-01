import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  BrowserProviderConfig,
  BrowserProviderConfigView,
  BrowserProviderProfileSyncPlanItem,
  BrowserProviderProfileSyncResponse,
  BrowserProviderTestStatus,
  BrowserProviderType,
  BrowserProfileSummary,
  CreateBrowserProviderConfigRequest,
  UpdateBrowserProviderConfigRequest,
} from '@/types';
import {
  formatAdsPowerProfileNotes,
  parseAdsPowerProfileMetadata,
} from '@/lib/browser-provider/adspower-metadata';
import { getDb } from './connection';

interface BrowserProviderRuntimeConfig {
  id: string;
  providerType: Exclude<BrowserProviderType, 'embedded'>;
  displayName: string;
  enabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  cdpEndpoint: string;
  profileId: string;
  profileName: string;
}

export interface BrowserProviderUsageSummary {
  contextId: string;
  chatSessionCount: number;
  scheduleCount: number;
  enabledScheduleCount: number;
}

export class BrowserProviderInUseError extends Error {
  constructor(message: string, readonly usage: BrowserProviderUsageSummary) {
    super(message);
    this.name = 'BrowserProviderInUseError';
  }
}

const RUNTIME_FILE_NAME = 'browser-providers.json';
const DEFAULT_ADSPOWER_API_BASE_URL = 'http://127.0.0.1:50325';
const LEGACY_ADSPOWER_API_BASE_URL = 'http://local.adspower.net:50325';

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAliasList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const alias = normalizeText(item);
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(alias);
  }
  return result;
}

function normalizeEnabled(value: boolean | undefined): number {
  return value === false ? 0 : 1;
}

function normalizeAdsPowerApiBaseUrl(value: unknown): string {
  const normalized = (normalizeText(value) || DEFAULT_ADSPOWER_API_BASE_URL).replace(/\/+$/, '');
  return normalized === LEGACY_ADSPOWER_API_BASE_URL ? DEFAULT_ADSPOWER_API_BASE_URL : normalized;
}

function defaultDisplayName(providerType: Exclude<BrowserProviderType, 'embedded'>): string {
  return providerType === 'adspower' ? 'AdsPower' : 'External CDP';
}

function contextIdForConfig(config: Pick<BrowserProviderConfig, 'id' | 'provider_type' | 'profile_id'>): string {
  if (config.provider_type === 'adspower') {
    return `adspower:${config.profile_id}`;
  }
  return `external-cdp:${config.id}`;
}

function maskSecret(value: string): string {
  if (!value) {
    return '';
  }
  if (value.length <= 8) {
    return '***';
  }
  return `***${value.slice(-4)}`;
}

function shouldRefreshSyncedDisplayName(config: BrowserProviderConfig, nextProfileName: string): boolean {
  const current = config.display_name.trim();
  const previousProfileName = config.profile_name.trim();
  if (!nextProfileName) {
    return false;
  }
  return !current
    || current === previousProfileName
    || current === config.profile_id
    || current === `AdsPower ${config.profile_id}`
    || current === 'AdsPower';
}

function normalizeProfileSummaryList(value: unknown): BrowserProfileSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const profiles: BrowserProfileSummary[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<BrowserProfileSummary>;
    const id = normalizeText(raw.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    profiles.push({
      id,
      name: normalizeText(raw.name) || id,
      status: normalizeText(raw.status),
      group: normalizeText(raw.group),
      serial_number: normalizeText(raw.serial_number),
    });
  }
  return profiles;
}

function mapView(config: BrowserProviderConfig): BrowserProviderConfigView {
  const usage = getBrowserProviderUsageSummary(contextIdForConfig(config));
  return {
    ...config,
    api_base_url: config.provider_type === 'adspower'
      ? normalizeAdsPowerApiBaseUrl(config.api_base_url)
      : config.api_base_url,
    api_key: maskSecret(config.api_key),
    has_api_key: config.api_key.trim().length > 0,
    context_id: contextIdForConfig(config),
    aliases: listBrowserProfileAliases(config.id),
    usage: {
      chat_session_count: usage.chatSessionCount,
      schedule_count: usage.scheduleCount,
      enabled_schedule_count: usage.enabledScheduleCount,
    },
  };
}

function getConfiguredDataDir(): string {
  return process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function getRuntimeFilePath(): string {
  return path.join(getConfiguredDataDir(), 'runtime', RUNTIME_FILE_NAME);
}

function requireValidUrl(raw: string, label: string): void {
  try {
    new URL(raw);
  } catch {
    throw new Error(`${label} 不是有效地址`);
  }
}

function assertConfigCanRun(config: Pick<BrowserProviderConfig, 'provider_type' | 'enabled' | 'api_base_url' | 'cdp_endpoint' | 'profile_id' | 'display_name'>): void {
  if (!config.enabled) {
    return;
  }

  if (config.provider_type === 'adspower') {
    if (!config.profile_id.trim()) {
      throw new Error(`浏览器「${config.display_name}」缺少 AdsPower Profile ID / user_id`);
    }
    requireValidUrl(normalizeAdsPowerApiBaseUrl(config.api_base_url), 'AdsPower Local API 地址');
    return;
  }

  if (config.provider_type === 'external-cdp') {
    if (!config.cdp_endpoint.trim()) {
      throw new Error(`浏览器「${config.display_name}」缺少 DevTools 地址`);
    }
    requireValidUrl(config.cdp_endpoint.trim(), 'DevTools 地址');
  }
}

function assertContextUnique(config: Pick<BrowserProviderConfig, 'id' | 'provider_type' | 'profile_id' | 'display_name'>): void {
  if (config.provider_type === 'adspower' && !config.profile_id.trim()) {
    return;
  }
  const contextId = contextIdForConfig(config);
  const duplicate = listBrowserProviderConfigsRaw().find((item) =>
    item.id !== config.id && contextIdForConfig(item) === contextId,
  );
  if (!duplicate) {
    return;
  }
  throw new Error(`浏览器「${config.display_name}」对应的上下文 ${contextId} 已存在，请直接编辑已有配置「${duplicate.display_name}」。`);
}

function countRows(sql: string, ...args: unknown[]): number {
  try {
    const row = getDb().prepare(sql).get(...args) as { count?: number } | undefined;
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

export function getBrowserProviderUsageSummary(contextId: string): BrowserProviderUsageSummary {
  const normalized = contextId.trim();
  return {
    contextId: normalized,
    chatSessionCount: countRows('SELECT COUNT(*) as count FROM chat_sessions WHERE browser_context_id = ?', normalized),
    scheduleCount: countRows('SELECT COUNT(*) as count FROM scheduled_workflows WHERE browser_context_id = ?', normalized),
    enabledScheduleCount: countRows('SELECT COUNT(*) as count FROM scheduled_workflows WHERE browser_context_id = ? AND enabled = 1', normalized),
  };
}

function formatUsage(summary: BrowserProviderUsageSummary, includeDisabledSchedules: boolean): string {
  const parts: string[] = [];
  if (summary.chatSessionCount > 0) {
    parts.push(`${summary.chatSessionCount} 个聊天会话`);
  }
  const scheduleCount = includeDisabledSchedules ? summary.scheduleCount : summary.enabledScheduleCount;
  if (scheduleCount > 0) {
    parts.push(includeDisabledSchedules
      ? `${scheduleCount} 个工作流任务`
      : `${scheduleCount} 个启用中的工作流任务`);
  }
  return parts.join('、');
}

function assertContextNotInUse(
  config: Pick<BrowserProviderConfig, 'display_name'>,
  contextId: string,
  action: string,
  options: { includeDisabledSchedules: boolean },
): void {
  const usage = getBrowserProviderUsageSummary(contextId);
  const scheduleCount = options.includeDisabledSchedules ? usage.scheduleCount : usage.enabledScheduleCount;
  if (usage.chatSessionCount === 0 && scheduleCount === 0) {
    return;
  }

  const details = formatUsage(usage, options.includeDisabledSchedules);
  throw new BrowserProviderInUseError(
    `无法${action}浏览器「${config.display_name}」，仍有 ${details} 正在使用。请先把这些会话或任务切换到其他浏览器。`,
    usage,
  );
}

function toRuntimeConfig(config: BrowserProviderConfig): BrowserProviderRuntimeConfig | null {
  if (!config.enabled) {
    return null;
  }
  if (config.provider_type !== 'external-cdp' && config.provider_type !== 'adspower') {
    return null;
  }
  if (config.provider_type === 'external-cdp' && !config.cdp_endpoint.trim()) {
    return null;
  }
  if (config.provider_type === 'adspower' && !config.profile_id.trim()) {
    return null;
  }
  return {
    id: config.id,
    providerType: config.provider_type,
    displayName: config.display_name,
    enabled: true,
    apiBaseUrl: config.provider_type === 'adspower'
      ? normalizeAdsPowerApiBaseUrl(config.api_base_url)
      : config.api_base_url,
    apiKey: config.api_key,
    cdpEndpoint: config.cdp_endpoint,
    profileId: config.profile_id,
    profileName: config.profile_name,
  };
}

export function syncBrowserProviderRuntimeFile(): void {
  const configs = listBrowserProviderConfigsRaw()
    .map(toRuntimeConfig)
    .filter((config): config is BrowserProviderRuntimeConfig => Boolean(config));
  const filePath = getRuntimeFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ configs, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

export function listBrowserProviderConfigsRaw(): BrowserProviderConfig[] {
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM browser_provider_configs
    ORDER BY created_at ASC
  `).all() as BrowserProviderConfig[];
}

export function listBrowserProfileAliases(configId: string): string[] {
  try {
    const rows = getDb().prepare(`
      SELECT alias
      FROM browser_profile_aliases
      WHERE config_id = ?
      ORDER BY rowid ASC
    `).all(configId) as Array<{ alias?: string }>;
    return rows.map((row) => row.alias || '').filter(Boolean);
  } catch {
    return [];
  }
}

function replaceBrowserProfileAliases(configId: string, aliases: string[]): void {
  const normalized = normalizeAliasList(aliases);
  const db = getDb();
  db.prepare('DELETE FROM browser_profile_aliases WHERE config_id = ?').run(configId);
  if (normalized.length === 0) {
    return;
  }
  const now = nowSql();
  const insert = db.prepare(`
    INSERT INTO browser_profile_aliases (id, config_id, alias, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const alias of normalized) {
    insert.run(crypto.randomUUID(), configId, alias, now, now);
  }
}

export function listBrowserProviderConfigs(): BrowserProviderConfigView[] {
  return listBrowserProviderConfigsRaw().map(mapView);
}

export function getBrowserProviderConfigRaw(id: string): BrowserProviderConfig | null {
  const db = getDb();
  return db.prepare('SELECT * FROM browser_provider_configs WHERE id = ?').get(id) as BrowserProviderConfig | undefined || null;
}

export function getBrowserProviderConfig(id: string): BrowserProviderConfigView | null {
  const config = getBrowserProviderConfigRaw(id);
  return config ? mapView(config) : null;
}

export function createBrowserProviderConfig(input: CreateBrowserProviderConfigRequest): BrowserProviderConfigView {
  const providerType = input.provider_type;
  if (providerType !== 'external-cdp' && providerType !== 'adspower') {
    throw new Error('Unsupported browser provider type');
  }

  const displayName = normalizeText(input.display_name) || defaultDisplayName(providerType);
  const id = crypto.randomUUID();
  const createdAt = nowSql();
  const draft: BrowserProviderConfig = {
    id,
    provider_type: providerType,
    display_name: displayName,
    enabled: normalizeEnabled(input.enabled),
    api_base_url: providerType === 'adspower' ? normalizeAdsPowerApiBaseUrl(input.api_base_url) : normalizeText(input.api_base_url),
    api_key: normalizeText(input.api_key),
    cdp_endpoint: normalizeText(input.cdp_endpoint),
    profile_id: normalizeText(input.profile_id),
    profile_name: normalizeText(input.profile_name),
    notes: normalizeText(input.notes),
    last_test_status: 'untested',
    last_test_message: '',
    last_profile_count: 0,
    last_tested_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
  assertConfigCanRun(draft);
  assertContextUnique(draft);

  const db = getDb();
  db.prepare(`
    INSERT INTO browser_provider_configs (
      id,
      provider_type,
      display_name,
      enabled,
      api_base_url,
      api_key,
      cdp_endpoint,
      profile_id,
      profile_name,
      notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draft.id,
    draft.provider_type,
    draft.display_name,
    draft.enabled,
    draft.api_base_url,
    draft.api_key,
    draft.cdp_endpoint,
    draft.profile_id,
    draft.profile_name,
    draft.notes,
    draft.created_at,
    draft.updated_at,
  );
  replaceBrowserProfileAliases(id, input.aliases ?? []);
  syncBrowserProviderRuntimeFile();
  const config = getBrowserProviderConfig(id);
  if (!config) {
    throw new Error('Failed to create browser provider config');
  }
  return config;
}

export function updateBrowserProviderConfig(
  id: string,
  input: UpdateBrowserProviderConfigRequest,
): BrowserProviderConfigView {
  const existing = getBrowserProviderConfigRaw(id);
  if (!existing) {
    throw new Error('Browser provider config not found');
  }

  const nextApiKey = input.clear_api_key
    ? ''
    : input.api_key !== undefined && input.api_key.trim()
      ? normalizeText(input.api_key)
      : existing.api_key;

  const nextConfig: BrowserProviderConfig = {
    ...existing,
    display_name: input.display_name !== undefined ? normalizeText(input.display_name) || existing.display_name : existing.display_name,
    enabled: input.enabled !== undefined ? normalizeEnabled(input.enabled) : existing.enabled,
    api_base_url: input.api_base_url !== undefined
      ? (existing.provider_type === 'adspower' ? normalizeAdsPowerApiBaseUrl(input.api_base_url) : normalizeText(input.api_base_url))
      : existing.api_base_url,
    api_key: nextApiKey,
    cdp_endpoint: input.cdp_endpoint !== undefined ? normalizeText(input.cdp_endpoint) : existing.cdp_endpoint,
    profile_id: input.profile_id !== undefined ? normalizeText(input.profile_id) : existing.profile_id,
    profile_name: input.profile_name !== undefined ? normalizeText(input.profile_name) : existing.profile_name,
    notes: input.notes !== undefined ? normalizeText(input.notes) : existing.notes,
    updated_at: nowSql(),
  };
  assertConfigCanRun(nextConfig);
  assertContextUnique(nextConfig);

  const existingContextId = contextIdForConfig(existing);
  const nextContextId = contextIdForConfig(nextConfig);
  if (existingContextId !== nextContextId) {
    assertContextNotInUse(existing, existingContextId, '修改', { includeDisabledSchedules: true });
  }
  if (existing.enabled === 1 && nextConfig.enabled === 0) {
    assertContextNotInUse(existing, existingContextId, '停用', { includeDisabledSchedules: false });
  }

  const db = getDb();
  db.prepare(`
    UPDATE browser_provider_configs
    SET
      display_name = ?,
      enabled = ?,
      api_base_url = ?,
      api_key = ?,
      cdp_endpoint = ?,
      profile_id = ?,
      profile_name = ?,
      notes = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    nextConfig.display_name,
    nextConfig.enabled,
    nextConfig.api_base_url,
    nextConfig.api_key,
    nextConfig.cdp_endpoint,
    nextConfig.profile_id,
    nextConfig.profile_name,
    nextConfig.notes,
    nextConfig.updated_at,
    id,
  );
  if (input.aliases !== undefined) {
    replaceBrowserProfileAliases(id, input.aliases);
  }
  syncBrowserProviderRuntimeFile();
  const config = getBrowserProviderConfig(id);
  if (!config) {
    throw new Error('Failed to update browser provider config');
  }
  return config;
}

export interface SyncAdsPowerBrowserProfilesInput {
  profiles: BrowserProfileSummary[];
  api_base_url?: string;
  api_key?: string;
  enabled?: boolean;
}

function buildAdsPowerSyncPlanItem(
  profile: BrowserProfileSummary,
  existing: BrowserProviderConfig | undefined,
  input: Pick<SyncAdsPowerBrowserProfilesInput, 'api_base_url' | 'api_key'>,
): BrowserProviderProfileSyncPlanItem {
  const contextId = `adspower:${profile.id}`;
  const nextNotes = formatAdsPowerProfileNotes(profile, existing?.notes || '');
  const metadata = parseAdsPowerProfileMetadata(nextNotes);

  if (!existing) {
    return {
      action: 'create',
      profile_id: profile.id,
      name: profile.name,
      context_id: contextId,
      display_name: profile.name || `AdsPower ${profile.id}`,
      group: metadata.group,
      serial_number: metadata.serialNumber,
      changes: ['新增浏览器配置'],
    };
  }

  const nextProfileName = profile.name || existing.profile_name;
  const nextDisplayName = shouldRefreshSyncedDisplayName(existing, nextProfileName)
    ? nextProfileName
    : existing.display_name;
  const changes: string[] = [];

  if (nextDisplayName !== existing.display_name) {
    changes.push(`显示名: ${existing.display_name || '空'} -> ${nextDisplayName || '空'}`);
  }
  if (nextProfileName !== existing.profile_name) {
    changes.push(`Profile 名称: ${existing.profile_name || '空'} -> ${nextProfileName || '空'}`);
  }
  if ((input.api_base_url || existing.api_base_url) !== existing.api_base_url) {
    changes.push('Local API 地址');
  }
  if (normalizeText(input.api_key) && !existing.api_key.trim()) {
    changes.push('补充 API Key');
  }

  const beforeMetadata = parseAdsPowerProfileMetadata(existing.notes || '');
  if (metadata.group !== beforeMetadata.group) {
    changes.push(`分组: ${beforeMetadata.group || '未分组'} -> ${metadata.group || '未分组'}`);
  }
  if (metadata.serialNumber !== beforeMetadata.serialNumber) {
    changes.push(`序号: ${beforeMetadata.serialNumber || '空'} -> ${metadata.serialNumber || '空'}`);
  }
  if (nextNotes !== existing.notes && changes.length === 0) {
    changes.push('备注元数据');
  }

  return {
    action: changes.length > 0 ? 'update' : 'unchanged',
    profile_id: profile.id,
    name: profile.name,
    context_id: contextId,
    display_name: nextDisplayName,
    group: metadata.group,
    serial_number: metadata.serialNumber,
    changes,
  };
}

export function previewAdsPowerBrowserProfileSync(
  input: SyncAdsPowerBrowserProfilesInput,
): BrowserProviderProfileSyncPlanItem[] {
  const profiles = normalizeProfileSummaryList(input.profiles);
  const existingByContext = new Map<string, BrowserProviderConfig>();
  for (const config of listBrowserProviderConfigsRaw()) {
    existingByContext.set(contextIdForConfig(config), config);
  }

  return profiles.map((profile) =>
    buildAdsPowerSyncPlanItem(profile, existingByContext.get(`adspower:${profile.id}`), input),
  );
}

export function syncAdsPowerBrowserProfiles(
  input: SyncAdsPowerBrowserProfilesInput,
): BrowserProviderProfileSyncResponse {
  const profiles = normalizeProfileSummaryList(input.profiles);
  const created: BrowserProviderProfileSyncResponse['created'] = [];
  const updated: BrowserProviderProfileSyncResponse['updated'] = [];
  const skipped: BrowserProviderProfileSyncResponse['skipped'] = [];
  let unchanged = 0;
  const existingByContext = new Map<string, BrowserProviderConfig>();
  for (const config of listBrowserProviderConfigsRaw()) {
    existingByContext.set(contextIdForConfig(config), config);
  }

  for (const profile of profiles) {
    const contextId = `adspower:${profile.id}`;
    const existing = existingByContext.get(contextId);
    const nextNotes = formatAdsPowerProfileNotes(profile, existing?.notes || '');
    const planItem = buildAdsPowerSyncPlanItem(profile, existing, input);

    if (existing) {
      if (planItem.action === 'unchanged') {
        unchanged += 1;
        continue;
      }
      try {
        const nextProfileName = profile.name || existing.profile_name;
        const config = updateBrowserProviderConfig(existing.id, {
          display_name: shouldRefreshSyncedDisplayName(existing, nextProfileName)
            ? nextProfileName
            : existing.display_name,
          profile_name: nextProfileName,
          api_base_url: input.api_base_url || existing.api_base_url,
          ...(normalizeText(input.api_key) && !existing.api_key.trim() ? { api_key: normalizeText(input.api_key) } : {}),
          notes: nextNotes,
        });
        updated.push(config);
        existingByContext.set(contextId, getBrowserProviderConfigRaw(existing.id) || existing);
      } catch (error) {
        skipped.push({
          profile_id: profile.id,
          name: profile.name,
          reason: error instanceof Error ? error.message : '同步更新失败',
        });
      }
      continue;
    }

    try {
      const config = createBrowserProviderConfig({
        provider_type: 'adspower',
        display_name: profile.name || `AdsPower ${profile.id}`,
        enabled: input.enabled,
        api_base_url: input.api_base_url,
        api_key: normalizeText(input.api_key),
        profile_id: profile.id,
        profile_name: profile.name,
        aliases: profile.name ? [profile.name] : [],
        notes: nextNotes,
      });
      created.push(config);
      const raw = getBrowserProviderConfigRaw(config.id);
      if (raw) {
        existingByContext.set(config.context_id, raw);
      }
    } catch (error) {
      skipped.push({
        profile_id: profile.id,
        name: profile.name,
        reason: error instanceof Error ? error.message : '同步创建失败',
      });
    }
  }

  return {
    created,
    updated,
    skipped,
    unchanged,
  };
}

export function deleteBrowserProviderConfig(id: string): void {
  const existing = getBrowserProviderConfigRaw(id);
  if (!existing) {
    throw new Error('Browser provider config not found');
  }
  assertContextNotInUse(existing, contextIdForConfig(existing), '删除', { includeDisabledSchedules: true });
  const db = getDb();
  db.prepare('DELETE FROM browser_provider_configs WHERE id = ?').run(id);
  syncBrowserProviderRuntimeFile();
}

export function updateBrowserProviderTestResult(
  id: string,
  result: {
    status: BrowserProviderTestStatus;
    message: string;
    profileCount: number;
  },
): BrowserProviderConfigView {
  const db = getDb();
  db.prepare(`
    UPDATE browser_provider_configs
    SET
      last_test_status = ?,
      last_test_message = ?,
      last_profile_count = ?,
      last_tested_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    result.status,
    result.message,
    Math.max(0, result.profileCount),
    nowSql(),
    nowSql(),
    id,
  );
  syncBrowserProviderRuntimeFile();
  const config = getBrowserProviderConfig(id);
  if (!config) {
    throw new Error('Browser provider config not found');
  }
  return config;
}
