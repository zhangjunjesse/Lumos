import type Database from 'better-sqlite3';

import { isGoofishNativeApp } from './goofish-app-sync';
import type { AppManifest } from './manifest/types';
import {
  runNativeAppCommand,
  type NativeAppCommandRunnerDeps,
} from './native-command-runner';
import { createAppDataStore, type AppDataStore } from './runtime/data-store';
import { getAppPlatformService } from './service';

export interface NativeAppImCommandResult {
  handled: boolean;
  ok: boolean;
  message: string;
  appId?: string;
  appName?: string;
  command?: string;
  runId?: string;
  error?: string;
}

export interface NativeAppImCommandBridgeDeps {
  db?: Database.Database;
  now?: () => number;
  goofish?: NativeAppCommandRunnerDeps['goofish'];
  replyDraft?: NativeAppCommandRunnerDeps['replyDraft'];
}

interface InstalledNativeApp {
  id: string;
  name: string;
  manifest: AppManifest;
}

interface CommandTemplateRow extends Record<string, unknown> {
  command?: string;
}

interface SupportedNativeImCommand {
  riskLevel: 'read' | 'low_write';
  confirmationRequired: boolean;
}

const SUPPORTED_GOOFISH_COMMANDS: Record<string, SupportedNativeImCommand> = {
  '/goofish status': { riskLevel: 'read', confirmationRequired: false },
  '/goofish unread': { riskLevel: 'read', confirmationRequired: false },
  '/goofish drafts': { riskLevel: 'read', confirmationRequired: false },
  '/goofish sync': { riskLevel: 'low_write', confirmationRequired: true },
};

const GENERIC_APP_COMMANDS: Record<string, SupportedNativeImCommand> = {
  '/status': { riskLevel: 'read', confirmationRequired: false },
  '/runs': { riskLevel: 'read', confirmationRequired: false },
  '/acceptance': { riskLevel: 'read', confirmationRequired: false },
  '/help': { riskLevel: 'read', confirmationRequired: false },
};

export async function runInstalledNativeAppImCommand(input: {
  commandText: string;
  confirmed?: boolean;
  deps?: NativeAppImCommandBridgeDeps;
}): Promise<NativeAppImCommandResult> {
  const rawCommand = normalizeCommandWhitespace(input.commandText);
  const command = normalizeCommandText(rawCommand);
  if (isGenericAppCommand(command)) {
    return runGenericInstalledAppCommand({
      commandText: rawCommand,
      deps: input.deps,
    });
  }
  if (!command.startsWith('/goofish')) {
    return { handled: false, ok: false, message: '' };
  }

  if (command === '/goofish' || command === '/goofish help') {
    return {
      handled: true,
      ok: true,
      command,
      message: goofishUsageText(),
    };
  }

  const spec = resolveSupportedGoofishCommand(command);
  if (!spec) {
    return {
      handled: true,
      ok: false,
      command,
      message: [
        '当前微信入口只支持低风险闲鱼应用命令：',
        '/goofish status',
        '/goofish unread',
        '/goofish drafts',
        '/goofish confirm <草稿编号>',
        '/goofish reject <草稿编号>',
        '/goofish sync',
        '/goofish draft <买家或商品>',
        '',
        '改价、下架、删除、批量修改和自动无确认回复暂不支持从微信命令触发。',
      ].join('\n'),
      error: 'unsupported-goofish-command',
    };
  }

  const db = input.deps?.db ?? getAppPlatformService().db;
  const app = findInstalledGoofishApp(db);
  if (!app) {
    return {
      handled: true,
      ok: false,
      command,
      message: [
        '还没有找到已启用的闲鱼助手应用。',
        '请先在 Lumos「应用」里创建并安装闲鱼助手，再使用 /goofish status 或 /goofish unread。',
      ].join('\n'),
      error: 'goofish-app-not-installed',
    };
  }

  const now = input.deps?.now?.() ?? Date.now();
  const store = createAppDataStore(db, app.id);
  const rowId = findOrCreateCommandTemplate(store, command, spec, new Date(now).toISOString());
  const runnerDeps: NativeAppCommandRunnerDeps = { now: () => now };
  if (input.deps?.goofish) runnerDeps.goofish = input.deps.goofish;
  if (input.deps?.replyDraft) runnerDeps.replyDraft = input.deps.replyDraft;
  const result = await runNativeAppCommand({
    manifest: app.manifest,
    store,
    rowId,
    confirmed: isExplicitWechatConfirmationCommand(command) || input.confirmed === true,
    deps: runnerDeps,
  });

  return {
    handled: true,
    ok: result.ok,
    appId: app.id,
    appName: app.name,
    command,
    runId: result.runId,
    message: formatReply(app, command, result.message, result.ok),
    error: result.error,
  };
}

async function runGenericInstalledAppCommand(input: {
  commandText: string;
  deps?: NativeAppImCommandBridgeDeps;
}): Promise<NativeAppImCommandResult> {
  const db = input.deps?.db ?? getAppPlatformService().db;
  const apps = listInstalledNativeApps(db);
  const parsed = parseGenericAppCommand(input.commandText);

  if (parsed.kind === 'usage') {
    return {
      handled: true,
      ok: true,
      command: parsed.command,
      message: genericAppUsageText(apps),
    };
  }

  if (parsed.kind === 'unsupported') {
    return {
      handled: true,
      ok: false,
      command: parsed.command,
      message: [
        '当前 /app 只支持通用只读应用命令：',
        '/app <应用名或ID> status',
        '/app <应用名或ID> runs',
        '/app <应用名或ID> acceptance',
        '/app <应用名或ID> help',
        '',
        '业务写操作、高风险操作和未声明命令不会从微信通用入口自动执行。',
      ].join('\n'),
      error: 'unsupported-app-command',
    };
  }

  const appMatch = resolveGenericAppTarget(apps, parsed.selector);
  if (!appMatch.ok) {
    return {
      handled: true,
      ok: false,
      command: parsed.command,
      message: appMatch.message,
      error: appMatch.error,
    };
  }

  const spec = GENERIC_APP_COMMANDS[parsed.nativeCommand];
  const now = input.deps?.now?.() ?? Date.now();
  const store = createAppDataStore(db, appMatch.app.id);
  const rowId = findOrCreateCommandTemplate(
    store,
    parsed.nativeCommand,
    spec,
    new Date(now).toISOString(),
    '由微信 /app 通用只读命令入口自动创建的命令模板。',
  );
  const result = await runNativeAppCommand({
    manifest: appMatch.app.manifest,
    store,
    rowId,
    confirmed: false,
    deps: { now: () => now },
  });

  return {
    handled: true,
    ok: result.ok,
    appId: appMatch.app.id,
    appName: appMatch.app.name,
    command: parsed.command,
    runId: result.runId,
    message: formatReply(appMatch.app, parsed.command, result.message, result.ok),
    error: result.error,
  };
}

function resolveSupportedGoofishCommand(command: string): SupportedNativeImCommand | null {
  const exact = SUPPORTED_GOOFISH_COMMANDS[command];
  if (exact) return exact;
  if (command === '/goofish draft' || command.startsWith('/goofish draft ')) {
    return { riskLevel: 'low_write', confirmationRequired: false };
  }
  if (command === '/goofish confirm' || command.startsWith('/goofish confirm ')) {
    return { riskLevel: 'low_write', confirmationRequired: true };
  }
  if (command === '/goofish reject' || command.startsWith('/goofish reject ')) {
    return { riskLevel: 'low_write', confirmationRequired: true };
  }
  return null;
}

function isGenericAppCommand(command: string): boolean {
  return command === '/app'
    || command.startsWith('/app ')
    || command === '/应用'
    || command.startsWith('/应用 ');
}

function isExplicitWechatConfirmationCommand(command: string): boolean {
  return command.startsWith('/goofish confirm ') || command.startsWith('/goofish reject ');
}

function listInstalledNativeApps(db: Database.Database): InstalledNativeApp[] {
  const rows = db.prepare(
    `SELECT id, name, manifest_json
       FROM lumos_app_apps
      WHERE enabled = 1
      ORDER BY COALESCE(last_used_at, installed_at) DESC, installed_at DESC`,
  ).all() as Array<{ id: string; name: string; manifest_json: string }>;

  const apps: InstalledNativeApp[] = [];
  for (const row of rows) {
    try {
      const manifest = JSON.parse(row.manifest_json) as AppManifest;
      apps.push({
        id: row.id,
        name: manifest.name || row.name,
        manifest,
      });
    } catch {
      // Skip corrupt app rows. Commands should only target valid enabled apps.
    }
  }
  return apps;
}

function findInstalledGoofishApp(db: Database.Database): InstalledNativeApp | null {
  for (const app of listInstalledNativeApps(db)) {
    if (isGoofishNativeApp(app.manifest)) {
      return app;
    }
  }
  return null;
}

function findOrCreateCommandTemplate(
  store: AppDataStore,
  command: string,
  spec: SupportedNativeImCommand,
  updatedAt: string,
  resultSummary = '由微信 /goofish 命令入口自动创建的低风险命令模板。',
): string {
  const existing = store
    .query<CommandTemplateRow>('app_command_runs', { limit: 200 })
    .find((row) => normalizeCommandText(row.command) === command);
  if (existing) return existing.id;

  return store.create('app_command_runs', {
    command,
    risk_level: spec.riskLevel,
    confirmation_required: spec.confirmationRequired,
    status: 'draft',
    result_summary: resultSummary,
    updated_at: updatedAt,
  }).id;
}

type ParsedGenericAppCommand =
  | { kind: 'usage'; command: string }
  | { kind: 'unsupported'; command: string }
  | {
      kind: 'run';
      command: string;
      selector: string;
      nativeCommand: keyof typeof GENERIC_APP_COMMANDS;
    };

function parseGenericAppCommand(commandText: string): ParsedGenericAppCommand {
  const normalized = normalizeCommandWhitespace(commandText);
  const lowerCommand = normalizeCommandText(normalized);
  const prefix = lowerCommand.startsWith('/应用') ? '/应用' : '/app';
  const rest = normalized.slice(prefix.length).trim();
  if (!rest || normalizeCommandText(rest) === '/help' || rest.toLowerCase() === 'help') {
    return { kind: 'usage', command: lowerCommand };
  }

  const parts = rest.split(/\s+/);
  const last = parts[parts.length - 1] ?? '';
  const action = toGenericNativeCommand(last);
  if (action) {
    return {
      kind: 'run',
      command: lowerCommand,
      selector: parts.slice(0, -1).join(' '),
      nativeCommand: action,
    };
  }

  if (parts.length === 1) {
    const singleAction = toGenericNativeCommand(parts[0]);
    if (singleAction) {
      return {
        kind: 'run',
        command: lowerCommand,
        selector: '',
        nativeCommand: singleAction,
      };
    }
  }

  return { kind: 'unsupported', command: lowerCommand };
}

function toGenericNativeCommand(value: string): keyof typeof GENERIC_APP_COMMANDS | null {
  const normalized = normalizeCommandText(value);
  const command = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return Object.prototype.hasOwnProperty.call(GENERIC_APP_COMMANDS, command)
    ? command as keyof typeof GENERIC_APP_COMMANDS
    : null;
}

function resolveGenericAppTarget(
  apps: InstalledNativeApp[],
  selector: string,
): { ok: true; app: InstalledNativeApp } | { ok: false; message: string; error: string } {
  if (apps.length === 0) {
    return {
      ok: false,
      message: [
        '还没有可用的已安装应用。',
        '请先在 Lumos「应用」里创建并安装一个应用，再使用 /app <应用名或ID> status。',
      ].join('\n'),
      error: 'app-not-installed',
    };
  }

  if (!selector.trim()) {
    if (apps.length === 1) {
      return { ok: true, app: apps[0] };
    }
    return {
      ok: false,
      message: [
        '已安装多个应用，请在 /app 后指定应用名或 ID。',
        formatInstalledAppList(apps),
        '示例：/app 客户记录 status',
      ].join('\n'),
      error: 'app-selector-required',
    };
  }

  const normalizedSelector = normalizeLookupText(selector);
  const exact = apps.filter((app) => appMatchesSelector(app, normalizedSelector, 'exact'));
  if (exact.length === 1) return { ok: true, app: exact[0] };

  const fuzzy = apps.filter((app) => appMatchesSelector(app, normalizedSelector, 'fuzzy'));
  if (fuzzy.length === 1) return { ok: true, app: fuzzy[0] };

  if (exact.length > 1 || fuzzy.length > 1) {
    return {
      ok: false,
      message: [
        `找到多个匹配“${selector}”的应用，请补充更完整的应用名或 ID。`,
        formatInstalledAppList((exact.length > 1 ? exact : fuzzy).slice(0, 8)),
      ].join('\n'),
      error: 'app-selector-ambiguous',
    };
  }

  return {
    ok: false,
    message: [
      `没有找到匹配“${selector}”的已启用应用。`,
      formatInstalledAppList(apps),
    ].join('\n'),
    error: 'app-not-found',
  };
}

function appMatchesSelector(
  app: InstalledNativeApp,
  normalizedSelector: string,
  mode: 'exact' | 'fuzzy',
): boolean {
  const candidates = [
    app.id,
    app.name,
    app.manifest.id,
    app.manifest.name,
  ].map(normalizeLookupText).filter(Boolean);
  if (mode === 'exact') {
    return candidates.some((candidate) => (
      candidate === normalizedSelector || candidate.slice(0, 8) === normalizedSelector
    ));
  }
  return candidates.some((candidate) => candidate.includes(normalizedSelector));
}

function genericAppUsageText(apps: InstalledNativeApp[]): string {
  return [
    '通用应用命令：',
    '/app <应用名或ID> status - 查看应用状态摘要',
    '/app <应用名或ID> runs - 查看最近运行结果',
    '/app <应用名或ID> acceptance - 查看验收进度',
    '/app <应用名或ID> help - 查看应用通用命令说明',
    '',
    apps.length > 0 ? formatInstalledAppList(apps) : '当前还没有可用的已安装应用。',
    '',
    '该入口只执行通用只读命令；业务写操作必须回到应用内确认。',
  ].join('\n');
}

function formatInstalledAppList(apps: InstalledNativeApp[]): string {
  if (apps.length === 0) return '当前没有可用的已安装应用。';
  return [
    '可用应用：',
    ...apps.slice(0, 8).map((app, index) => `${index + 1}. ${app.name} (${app.id})`),
  ].join('\n');
}

function normalizeCommandText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function normalizeCommandWhitespace(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeLookupText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function goofishUsageText(): string {
  return [
    '闲鱼助手命令：',
    '/goofish status - 查看应用内闲鱼账号同步状态',
    '/goofish unread - 查看应用内未读买家会话',
    '/goofish drafts - 查看待确认回复草稿',
    '/goofish draft <买家或商品> - 生成本地回复草稿，不发送',
    '/goofish confirm <草稿编号> - 确认发送指定草稿',
    '/goofish reject <草稿编号> - 拒绝指定草稿，不发送',
    '/goofish sync - 记录同步请求，但必须回到应用内确认后执行',
  ].join('\n');
}

function formatReply(
  app: InstalledNativeApp,
  command: string,
  message: string,
  ok: boolean,
): string {
  if (command === '/goofish sync' && !ok) {
    return [
      `已记录「${app.name}」的 /goofish sync 请求。`,
      '第一阶段不会在微信里静默触发同步；请打开应用的「通知命令」或「账号 / 买家会话」页面，由界面确认后执行。',
      `原因：${message}`,
    ].join('\n');
  }

  return ok
    ? `「${app.name}」\n${message}`
    : `「${app.name}」命令执行失败：${message}`;
}
