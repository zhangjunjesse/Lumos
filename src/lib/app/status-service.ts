import fs from 'fs';
import path from 'path';

import type Database from 'better-sqlite3';

import type { AppManifest } from './manifest/types';
import { isGoofishNativeApp } from './goofish-app-sync';
import { createAppDataStore, type AppDataStore } from './runtime/data-store';
import { getDefaultUserImTarget } from './im-bridge';
import { isAppImNotificationPermissionGranted } from './im-notifications';

export type NativeAppComputedStatus =
  | 'not_configured'
  | 'ready'
  | 'running'
  | 'failed'
  | 'not_connected';

export interface NativeAppStatusSummary {
  appId: string;
  appName: string;
  status: NativeAppComputedStatus;
  label: string;
  message: string;
  checkedAt: number;
  counts: {
    settings: number;
    runHistory: number;
    runningRuns: number;
    failedRuns: number;
    acceptanceTotal: number;
    acceptancePassed: number;
    acceptanceIssues: number;
  };
  latestRun?: {
    source: 'app_run' | 'run_history';
    status: 'running' | 'success' | 'failed' | 'cancelled';
    title?: string;
    summary?: string;
    failureReason?: string;
    updatedAt?: number;
  };
  missingCapabilities: string[];
  readyCriteria: string[];
  notConnectedBehavior?: string;
}

interface AppRow {
  id: string;
  name: string;
  enabled: number;
  manifest_json: string;
  install_path: string;
}

interface NativeAppSpecShape {
  status?: {
    readyCriteria?: unknown;
    notConnectedBehavior?: unknown;
  };
  ai?: { enabled?: unknown };
  automations?: { enabled?: unknown };
  im?: { enabled?: unknown; lowRiskCommands?: unknown };
  acceptance?: unknown;
}

interface RunHistoryRow {
  id: string;
  title?: unknown;
  status?: unknown;
  summary?: unknown;
  failure_reason?: unknown;
  updated_at?: unknown;
}

interface GoofishAccountRow {
  login_status?: unknown;
  sync_status?: unknown;
}

interface CommandRunRow {
  command?: unknown;
  status?: unknown;
}

interface DeclaredImCommand {
  display: string;
  matches: (command: string) => boolean;
}

interface NotificationRow {
  channel?: unknown;
  status?: unknown;
}

interface AcceptanceCheckRow {
  status?: unknown;
  done?: unknown;
}

interface DbRunRow {
  status: 'running' | 'success' | 'failed' | 'cancelled';
  workflow_id: string | null;
  page_id: string | null;
  output_json: string | null;
  error_message: string | null;
  started_at: number;
  ended_at: number | null;
}

export function getNativeAppStatus(
  db: Database.Database,
  appId: string,
  opts: { now?: number } = {},
): NativeAppStatusSummary | null {
  const row = db
    .prepare(
      `SELECT id, name, enabled, manifest_json, install_path
       FROM lumos_app_apps WHERE id = ?`,
    )
    .get(appId) as AppRow | undefined;
  if (!row) return null;

  const manifest = safeJson<AppManifest>(row.manifest_json) ?? {
    id: row.id,
    name: row.name,
    version: '',
    icon: '',
    entry: '',
  };
  const spec = readNativeSpec(row.install_path);
  const store = createAppDataStore(db, appId);
  const settingsCount = safeCount(() => store.count('app_settings'));
  const runHistoryRows = safeRows(() => store.query<RunHistoryRow>('run_history', { limit: 5 }));
  const latestAppRun = getLatestAppRun(db, appId);
  const runCounts = getAppRunCounts(db, appId);
  const latestRun = pickLatestRun(latestAppRun, runHistoryRows[0]);
  const acceptanceCounts = getAcceptanceCounts(store, spec);
  const missingCapabilities = detectMissingCapabilities({
    enabled: row.enabled === 1,
    db,
    appId,
    manifest,
    spec,
    store,
  });

  const status = computeNativeStatus({
    settingsCount,
    latestRunStatus: latestRun?.status,
    runningRuns: runCounts.running + countRowsByStatus(runHistoryRows, 'running'),
    missingCapabilities,
  });

  return {
    appId: row.id,
    appName: row.name,
    status,
    label: statusLabel(status),
    message: statusMessage(status, missingCapabilities),
    checkedAt: opts.now ?? Date.now(),
    counts: {
      settings: settingsCount,
      runHistory: safeCount(() => store.count('run_history')),
      runningRuns: runCounts.running + countRowsByStatus(runHistoryRows, 'running'),
      failedRuns: runCounts.failed + countRowsByStatus(runHistoryRows, 'failed'),
      ...acceptanceCounts,
    },
    latestRun,
    missingCapabilities,
    readyCriteria: stringArray(spec?.status?.readyCriteria),
    notConnectedBehavior: typeof spec?.status?.notConnectedBehavior === 'string'
      ? spec.status.notConnectedBehavior
      : undefined,
  };
}

export function computeNativeStatus(input: {
  settingsCount: number;
  latestRunStatus?: 'running' | 'success' | 'failed' | 'cancelled';
  runningRuns: number;
  missingCapabilities: string[];
}): NativeAppComputedStatus {
  if (input.runningRuns > 0 || input.latestRunStatus === 'running') return 'running';
  if (input.missingCapabilities.length > 0) return 'not_connected';
  if (input.settingsCount === 0) return 'not_configured';
  if (input.latestRunStatus === 'failed') return 'failed';
  return 'ready';
}

function readNativeSpec(installPath: string): NativeAppSpecShape | null {
  const specPath = path.join(installPath, 'native-app-spec.json');
  try {
    if (!fs.existsSync(specPath)) return null;
    return safeJson<NativeAppSpecShape>(fs.readFileSync(specPath, 'utf-8'));
  } catch {
    return null;
  }
}

function detectMissingCapabilities(input: {
  enabled: boolean;
  db: Database.Database;
  appId: string;
  manifest: AppManifest;
  spec: NativeAppSpecShape | null;
  store: AppDataStore;
}): string[] {
  const missing: string[] = [];
  const systemPermissions = input.manifest.permissions?.system ?? [];
  if (!input.enabled) {
    missing.push('应用已停用');
  }
  if ((input.manifest.triggers ?? []).length > 0 || input.spec?.automations?.enabled === true) {
    if (!systemPermissions.includes('schedule')) {
      missing.push('自动化应用尚未声明 system.schedule 权限');
    }
  }
  const wantsImNotifications = input.spec?.im?.enabled === true
    || systemPermissions.includes('im-notification');
  if (wantsImNotifications) {
    if (!isAppImNotificationPermissionGranted(input.db, input.appId)) {
      missing.push('应用尚未获得 IM 通知权限');
    } else if (!getDefaultUserImTarget(input.db)) {
      missing.push('微信 IM 通知目标尚未绑定');
    }
    const notificationRows = safeRows(() => input.store.query<NotificationRow>('app_notifications', { limit: 20 }));
    if (
      notificationRows.length > 0
      && !notificationRows.some((row) => row.status === 'ready' || row.status === 'sent')
    ) {
      missing.push('微信 IM 通知尚未测试成功');
    }
    const lowRiskCommands = input.spec?.im?.lowRiskCommands;
    if (Array.isArray(lowRiskCommands) && lowRiskCommands.length > 0) {
      const commandRows = safeRows(() => input.store.query<CommandRunRow>('app_command_runs', { limit: 50 }));
      missing.push(...detectMissingCommandReadiness(lowRiskCommands, commandRows));
    }
  }
  if (isGoofishNativeApp(input.manifest)) {
    missing.push(...detectMissingGoofishReadiness(input.store));
  }
  return missing;
}

function detectMissingCommandReadiness(
  lowRiskCommands: unknown[],
  commandRows: CommandRunRow[],
): string[] {
  const declared = lowRiskCommands
    .map(toDeclaredImCommand)
    .filter((command): command is DeclaredImCommand => Boolean(command));
  if (declared.length === 0) return [];
  if (commandRows.length === 0) {
    return [`IM 命令模板尚未添加：${declared.map((command) => command.display).join('、')}`];
  }

  const normalizedRows = commandRows
    .map((row) => ({ row, command: normalizeImCommand(row.command) }))
    .filter((entry): entry is { row: CommandRunRow; command: string } => Boolean(entry.command));

  const missingTemplates = declared.filter((declaredCommand) => (
    !normalizedRows.some((entry) => declaredCommand.matches(entry.command))
  ));
  const notSuccessful = declared.filter((declaredCommand) => {
    const matches = normalizedRows.filter((entry) => declaredCommand.matches(entry.command));
    return matches.length > 0 && !matches.some((entry) => entry.row.status === 'success');
  });
  const missing: string[] = [];
  if (missingTemplates.length > 0) {
    missing.push(`IM 命令模板尚未添加：${missingTemplates.map((command) => command.display).join('、')}`);
  }
  if (notSuccessful.length > 0) {
    missing.push(`IM 命令尚未测试成功：${notSuccessful.map((command) => command.display).join('、')}`);
  }
  return missing;
}

function toDeclaredImCommand(value: unknown): DeclaredImCommand | null {
  const display = normalizeImCommand(value);
  if (!display) return null;
  const placeholderIndex = display.indexOf('<');
  if (placeholderIndex === -1) {
    return {
      display,
      matches: (command) => command === display,
    };
  }
  const prefix = display.slice(0, placeholderIndex).trimEnd();
  if (!prefix) return null;
  return {
    display,
    matches: (command) => command === prefix || command.startsWith(`${prefix} `),
  };
}

function normalizeImCommand(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return null;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function detectMissingGoofishReadiness(store: AppDataStore): string[] {
  const accounts = safeRows(() => store.query<GoofishAccountRow>('goofish_accounts', { limit: 50 }));
  if (accounts.length === 0) {
    return ['闲鱼账号状态尚未同步，请先在账号页点击“同步闲鱼数据”。'];
  }
  const readyAccounts = accounts.filter((row) => row.login_status === 'ready');
  if (readyAccounts.length === 0) {
    return ['还没有登录可用的闲鱼账号，请先到「扩展 > 闲鱼」完成登录后再同步。'];
  }
  const syncedAccounts = readyAccounts.filter((row) => row.sync_status === 'success');
  if (syncedAccounts.length === 0) {
    return ['闲鱼账号最近一次同步尚未成功，请先同步闲鱼数据并查看运行结果。'];
  }
  return [];
}

function getAcceptanceCounts(
  store: AppDataStore,
  spec: NativeAppSpecShape | null,
): Pick<
  NativeAppStatusSummary['counts'],
  'acceptanceTotal' | 'acceptancePassed' | 'acceptanceIssues'
> {
  const rows = safeRows(() => store.query<AcceptanceCheckRow>('acceptance_checks', { limit: 500 }));
  const total = Array.isArray(spec?.acceptance) ? spec.acceptance.length : rows.length;
  let passed = 0;
  let issues = 0;
  for (const row of rows) {
    const status = acceptanceStatus(row);
    if (status === 'passed') passed += 1;
    if (status === 'failed' || status === 'blocked') issues += 1;
  }
  return {
    acceptanceTotal: total,
    acceptancePassed: passed,
    acceptanceIssues: issues,
  };
}

function acceptanceStatus(row: AcceptanceCheckRow): 'unverified' | 'passed' | 'failed' | 'blocked' {
  if (row.status === 'passed' || row.status === 'failed' || row.status === 'blocked') {
    return row.status;
  }
  return row.done === true ? 'passed' : 'unverified';
}

function getLatestAppRun(db: Database.Database, appId: string): DbRunRow | null {
  const row = db
    .prepare(
      `SELECT status, workflow_id, page_id, output_json, error_message, started_at, ended_at
       FROM lumos_app_runs
       WHERE app_id = ?
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(appId) as DbRunRow | undefined;
  return row ?? null;
}

function getAppRunCounts(
  db: Database.Database,
  appId: string,
): Record<'running' | 'success' | 'failed' | 'cancelled', number> {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM lumos_app_runs
       WHERE app_id = ?
       GROUP BY status`,
    )
    .all(appId) as Array<{ status: 'running' | 'success' | 'failed' | 'cancelled'; count: number }>;
  return {
    running: rows.find((row) => row.status === 'running')?.count ?? 0,
    success: rows.find((row) => row.status === 'success')?.count ?? 0,
    failed: rows.find((row) => row.status === 'failed')?.count ?? 0,
    cancelled: rows.find((row) => row.status === 'cancelled')?.count ?? 0,
  };
}

function pickLatestRun(
  appRun: DbRunRow | null,
  runHistory: RunHistoryRow | undefined,
): NativeAppStatusSummary['latestRun'] {
  if (appRun) {
    return {
      source: 'app_run',
      status: appRun.status,
      title: appRun.workflow_id ?? appRun.page_id ?? '应用运行',
      summary: appRun.output_json ? summarizeJson(appRun.output_json) : undefined,
      failureReason: appRun.error_message ?? undefined,
      updatedAt: appRun.ended_at ?? appRun.started_at,
    };
  }
  if (!runHistory || !isRunStatus(runHistory.status)) return undefined;
  return {
    source: 'run_history',
    status: runHistory.status,
    title: typeof runHistory.title === 'string' ? runHistory.title : undefined,
    summary: typeof runHistory.summary === 'string' ? runHistory.summary : undefined,
    failureReason: typeof runHistory.failure_reason === 'string'
      ? runHistory.failure_reason
      : undefined,
    updatedAt: typeof runHistory.updated_at === 'number' ? runHistory.updated_at : undefined,
  };
}

function statusLabel(status: NativeAppComputedStatus): string {
  switch (status) {
    case 'not_configured':
      return '未配置';
    case 'ready':
      return '已就绪';
    case 'running':
      return '运行中';
    case 'failed':
      return '失败';
    case 'not_connected':
      return '未接入';
  }
}

function statusMessage(status: NativeAppComputedStatus, missingCapabilities: string[]): string {
  switch (status) {
    case 'running':
      return '应用有运行正在执行，运行结果页应展示最新进度。';
    case 'not_connected':
      return missingCapabilities[0] ?? '存在尚未接入的底层能力。';
    case 'not_configured':
      return '需要先进入设置页保存基础配置。';
    case 'failed':
      return '最近一次运行失败，请查看运行结果页里的失败原因。';
    case 'ready':
      return '应用已具备基础配置，可以打开工作台或发起运行。';
  }
}

function countRowsByStatus(
  rows: RunHistoryRow[],
  status: 'running' | 'success' | 'failed' | 'cancelled',
): number {
  return rows.filter((row) => row.status === status).length;
}

function safeCount(fn: () => number): number {
  try {
    return fn();
  } catch {
    return 0;
  }
}

function safeRows<T>(fn: () => T[]): T[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

function safeJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function isRunStatus(value: unknown): value is 'running' | 'success' | 'failed' | 'cancelled' {
  return value === 'running' || value === 'success' || value === 'failed' || value === 'cancelled';
}

function summarizeJson(content: string): string {
  const parsed = safeJson<unknown>(content);
  if (typeof parsed === 'string') return parsed;
  if (parsed && typeof parsed === 'object') {
    const candidate = parsed as { summary?: unknown; text?: unknown; message?: unknown };
    const text = candidate.summary ?? candidate.text ?? candidate.message;
    if (typeof text === 'string') return text;
  }
  return content.slice(0, 200);
}
