import fs from 'fs';
import path from 'path';

import type Database from 'better-sqlite3';

import { validateNativeGradeAppSpec } from '@/lib/app/builder/native-grade-spec';

import { parseApp } from './manifest/parser';
import { validateApp } from './manifest/validator';
import { createAppDataStore, type AppDataStore } from './runtime/data-store';

export interface NativeInstallSelfCheckResult {
  runId: string;
  status: 'success' | 'failed';
  summary: string;
  checked: string[];
  failures: string[];
}

interface NativeSpecShape {
  automations?: {
    enabled?: unknown;
  };
  data?: {
    entities?: unknown;
  };
  im?: {
    enabled?: unknown;
    lowRiskCommands?: unknown;
  };
  acceptance?: Array<{ id?: unknown }>;
}

interface DataSchemaShape {
  collections?: Array<{ name?: unknown; fields?: Array<{ name?: unknown }> }>;
}

interface RoutesShape {
  menu?: Array<{ id?: unknown; page?: unknown }>;
}

interface AppJsonShape {
  permissions?: {
    system?: unknown;
  };
}

const REQUIRED_NATIVE_MENU_IDS = ['status', 'settings', 'automations', 'im', 'run-history'];

export function recordNativeInstallSelfCheck(
  db: Database.Database,
  input: {
    appId: string;
    installPath: string;
    now?: number;
  },
): NativeInstallSelfCheckResult {
  const now = input.now ?? Date.now();
  const checked: string[] = [];
  const failures: string[] = [];

  const add = (label: string, ok: boolean, detail?: string) => {
    if (ok) {
      checked.push(label);
    } else {
      failures.push(detail ? `${label}：${detail}` : label);
    }
  };

  const fileMap = collectJsonFileMap(input.installPath);
  const spec = readJson<NativeSpecShape>(path.join(input.installPath, 'native-app-spec.json'));
  const appJson = readJson<AppJsonShape>(path.join(input.installPath, 'app.json'));
  const dataSchema = readJson<DataSchemaShape>(path.join(input.installPath, 'data-schema.json'));
  const routes = readJson<RoutesShape>(path.join(input.installPath, 'routes.json'));
  const statusPage = readJson<unknown>(path.join(input.installPath, 'pages/status.json'));
  const settingsPage = readJson<unknown>(path.join(input.installPath, 'pages/settings.json'));
  const inboxPage = readJson<unknown>(path.join(input.installPath, 'pages/inbox.json'));
  const draftsPage = readJson<unknown>(path.join(input.installPath, 'pages/drafts.json'));
  const automationsPage = readJson<unknown>(path.join(input.installPath, 'pages/automations.json'));
  const imPage = readJson<unknown>(path.join(input.installPath, 'pages/im.json'));
  const runHistoryPage = readJson<unknown>(path.join(input.installPath, 'pages/run-history.json'));

  add('应用目录存在', fs.existsSync(input.installPath), input.installPath);
  add('app.json 存在', fileMap.has('app.json'));
  add('routes.json 存在', fileMap.has('routes.json'));
  add('data-schema.json 存在', fileMap.has('data-schema.json'));
  add('native-app-spec.json 存在', fileMap.has('native-app-spec.json'));

  const parsed = parseApp(input.installPath);
  if (parsed.ok) {
    checked.push('应用 manifest / routes / pages schema 可解析');
    const crossIssues = validateApp(parsed.app);
    const crossErrors = crossIssues.filter((issue) => issue.level === 'error');
    add(
      '跨文件引用一致',
      crossErrors.length === 0,
      crossErrors.map((issue) => `${issue.file} ${issue.jsonPath}: ${issue.message}`).join('\n'),
    );
  } else {
    failures.push(
      `应用 manifest / routes / pages schema 可解析：${parsed.issues
        .map((issue) => `${issue.file} ${issue.jsonPath}: ${issue.message}`)
        .join('\n')}`,
    );
  }

  const nativeIssues = validateNativeGradeAppSpec(fileMap);
  add(
    '内置级规格有效',
    nativeIssues.length === 0,
    nativeIssues.map((issue) => `${issue.jsonPath}: ${issue.message}`).join('\n'),
  );

  const menuIds = new Set((routes?.menu ?? []).map((item) => item.id).filter(isString));
  const missingMenu = REQUIRED_NATIVE_MENU_IDS.filter((id) => !menuIds.has(id));
  add(
    '通用页面入口齐全',
    missingMenu.length === 0,
    missingMenu.length > 0 ? `缺少 ${missingMenu.join(', ')}` : undefined,
  );

  const pageRefs = (routes?.menu ?? []).map((item) => item.page).filter(isString);
  const missingPages = pageRefs.filter((pageRef) => !fs.existsSync(path.join(input.installPath, pageRef)));
  add(
    '菜单页面文件存在',
    missingPages.length === 0,
    missingPages.length > 0 ? `缺少 ${missingPages.join(', ')}` : undefined,
  );

  const collections = new Set(
    (dataSchema?.collections ?? []).map((collection) => collection.name).filter(isString),
  );
  const entities = Array.isArray(spec?.data?.entities)
    ? spec.data.entities.filter(isString)
    : [];
  const missingEntities = entities.filter((entity) => !collections.has(entity));
  add(
    '规格声明的数据集合已落到 data-schema',
    missingEntities.length === 0,
    missingEntities.length > 0 ? `缺少 ${missingEntities.join(', ')}` : undefined,
  );

  add(
    '通用集合字段可支撑内置级运行',
    requiredCollectionFields(dataSchema).length === 0,
    requiredCollectionFields(dataSchema).join('\n'),
  );

  const dataStoreFailure = verifyAppDataStoreRoundTrip(db, input.appId, now);
  add(
    '应用隔离数据读写可用',
    dataStoreFailure === null,
    dataStoreFailure ?? undefined,
  );

  add(
    '状态页包含重新自检入口',
    pageContains(statusPage, ['native:app:run-self-check']),
    '缺少 native:app:run-self-check',
  );

  add(
    '设置页包含 AI 提示词和风险边界',
    pageContains(settingsPage, ['ai_system_prompt', 'risk_note']),
    '缺少 ai_system_prompt 或 risk_note 设置字段',
  );

  add(
    '自动化页包含手动运行和定时同步入口',
    pageContains(automationsPage, ['native:app:run-automation', 'native:app:sync-automation-schedule']),
    '缺少 native:app:run-automation 或 native:app:sync-automation-schedule',
  );

  add(
    '通知命令页包含命令测试入口',
    pageContains(imPage, ['native:app:run-command']),
    '缺少 native:app:run-command',
  );
  add(
    '通知命令页包含通用 /app 只读命令说明',
    pageContains(imPage, ['/app', 'status', 'runs', 'acceptance', 'help']),
    '缺少 /app status / runs / acceptance / help 外部只读命令说明',
  );
  const missingImCommands = missingDeclaredImCommands(imPage, spec?.im?.lowRiskCommands);
  add(
    '通知命令页覆盖规格声明的低风险命令',
    missingImCommands.length === 0,
    missingImCommands.length > 0 ? `缺少 ${missingImCommands.join('、')}` : undefined,
  );

  if (entities.includes('buyer_conversations') && entities.includes('reply_drafts')) {
    add(
      '闲鱼会话页包含草稿生成入口',
      pageContains(inboxPage, ['native:goofish:generate-reply-draft']),
      '缺少 native:goofish:generate-reply-draft',
    );
    add(
      '回复草稿页包含发送和拒绝入口',
      pageContains(draftsPage, ['native:goofish:send-draft', 'native:goofish:reject-draft']),
      '缺少 native:goofish:send-draft 或 native:goofish:reject-draft',
    );
  }

  add(
    '运行结果页展示失败原因',
    pageContains(runHistoryPage, ['failure_reason']),
    '缺少 failure_reason 展示字段',
  );

  const systemPermissions = asStringArray(appJson?.permissions?.system);
  if (spec?.automations?.enabled === true) {
    add(
      '自动化应用声明 system.schedule 权限',
      systemPermissions.includes('schedule'),
      'native-app-spec 声明 automations.enabled=true，但 app.json 未声明 system.schedule',
    );
  }
  if (spec?.im?.enabled === true) {
    add(
      'IM 应用声明 system.im-notification 权限',
      systemPermissions.includes('im-notification'),
      'native-app-spec 声明 im.enabled=true，但 app.json 未声明 system.im-notification',
    );
  }

  const acceptanceCount = Array.isArray(spec?.acceptance) ? spec.acceptance.length : 0;
  add(
    '验收清单可见',
    acceptanceCount >= 5,
    `当前 ${acceptanceCount} 项，至少需要 5 项`,
  );
  const acceptanceIds = new Set(
    Array.isArray(spec?.acceptance)
      ? spec.acceptance.map((item) => item.id).filter(isString)
      : [],
  );
  add(
    '验收清单包含安装自检项',
    acceptanceIds.has('installation-self-check'),
    '缺少 installation-self-check，安装自检结果无法自动落到验收清单',
  );

  const status: NativeInstallSelfCheckResult['status'] = failures.length > 0 ? 'failed' : 'success';
  const summary = status === 'success'
    ? `安装自检通过：${checked.length} 项检查通过，应用至少具备可打开、可配置、可验收的基础结构。`
    : `安装自检失败：${failures.length} 项未通过，请先修复规格、页面或数据集合。`;
  const runId = `native-install-self-check-${now}`;
  const result: NativeInstallSelfCheckResult = {
    runId,
    status,
    summary,
    checked,
    failures,
  };
  const store = createAppDataStore(db, input.appId);

  try {
    store.create('run_history', {
      id: runId,
      title: '安装自检',
      status,
      summary,
      failure_reason: failures.join('\n'),
      updated_at: now,
    });
  } catch {
    // Do not fail installation because evidence writing failed. The API still
    // returns the self-check result so the caller can surface it.
  }
  try {
    recordInstallSelfCheckAcceptance(store, result, now);
  } catch {
    // Acceptance evidence is best-effort; the run_history row and API response
    // remain the source of truth when evidence writing is unavailable.
  }

  return result;
}

function collectJsonFileMap(rootPath: string): Map<string, string> {
  const files = new Map<string, string>();
  walk(rootPath, (filePath) => {
    if (!filePath.endsWith('.json')) return;
    const rel = path.relative(rootPath, filePath).split(path.sep).join(path.posix.sep);
    files.set(rel, fs.readFileSync(filePath, 'utf-8'));
  });
  return files;
}

function walk(rootPath: string, visit: (filePath: string) => void): void {
  if (!fs.existsSync(rootPath)) return;
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, visit);
    } else if (entry.isFile()) {
      visit(fullPath);
    }
  }
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function pageContains(page: unknown, needles: string[]): boolean {
  const text = JSON.stringify(page ?? {});
  return needles.every((needle) => text.includes(needle));
}

function missingDeclaredImCommands(page: unknown, commands: unknown): string[] {
  if (!Array.isArray(commands) || commands.length === 0) return [];
  const text = normalizeText(JSON.stringify(page ?? {}));
  return commands
    .map(normalizeCommand)
    .filter((command): command is string => Boolean(command))
    .filter((command) => !pageMentionsCommand(text, command));
}

function pageMentionsCommand(pageText: string, declaredCommand: string): boolean {
  const placeholderIndex = declaredCommand.indexOf('<');
  if (placeholderIndex === -1) {
    return pageText.includes(declaredCommand);
  }
  const prefix = declaredCommand.slice(0, placeholderIndex).trimEnd();
  return Boolean(prefix) && pageText.includes(`${prefix} `);
}

function normalizeCommand(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function recordInstallSelfCheckAcceptance(
  store: AppDataStore,
  result: NativeInstallSelfCheckResult,
  now: number,
): void {
  const id = 'installation-self-check';
  const updatedAt = new Date(now).toISOString();
  const passed = result.status === 'success';
  const row = {
    id,
    acceptance_id: id,
    done: passed,
    status: passed ? 'passed' : 'failed',
    evidence: result.summary,
    failure_reason: passed ? null : result.failures.join('\n'),
    evidence_run_id: result.runId,
    completed_at: passed ? updatedAt : null,
    updated_at: updatedAt,
  };
  const existing = store.get('acceptance_checks', id);
  if (existing) {
    store.update('acceptance_checks', id, row);
  } else {
    store.create('acceptance_checks', row);
  }
}

function verifyAppDataStoreRoundTrip(
  db: Database.Database,
  appId: string,
  now: number,
): string | null {
  const store = createAppDataStore(db, appId);
  const collection = 'run_history';
  const probeId = `native-install-self-check-probe-${now}`;
  const marker = `native_install_self_check_${now}`;
  let created = false;

  try {
    const createdRow = store.create(collection, {
      id: probeId,
      title: '安装自检探针',
      status: 'running',
      summary: '验证应用隔离数据集合能否创建、读取、更新、查询和删除。',
      failure_reason: '',
      self_check_marker: marker,
      updated_at: now,
    });
    created = true;
    if (createdRow.id !== probeId) {
      return `创建返回的行 ID 不一致：${createdRow.id}`;
    }

    const fetched = store.get(collection, probeId);
    if (!fetched || fetched.self_check_marker !== marker) {
      return '创建后无法读取探针记录';
    }

    const matchingRows = store.query(collection, {
      filter: { self_check_marker: marker },
      limit: 5,
    });
    if (!matchingRows.some((row) => row.id === probeId)) {
      return '按字段筛选无法查询到探针记录';
    }

    const matchingCount = store.count(collection, { self_check_marker: marker });
    if (matchingCount < 1) {
      return '按字段筛选无法统计探针记录';
    }

    const updated = store.update(collection, probeId, {
      status: 'success',
      summary: '应用隔离数据读写探针通过。',
    });
    if (!updated || updated.status !== 'success') {
      return '无法更新探针记录';
    }

    const deleted = store.delete(collection, probeId);
    if (!deleted) {
      return '无法删除探针记录';
    }
    created = false;

    const afterDelete = store.get(collection, probeId);
    if (afterDelete) {
      return '删除后仍能读取到探针记录';
    }

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    if (created) {
      try {
        store.delete(collection, probeId);
      } catch {
        // Best-effort cleanup only. The failure above is reported to the caller.
      }
    }
  }
}

function requiredCollectionFields(dataSchema: DataSchemaShape | null): string[] {
  const required: Record<string, string[]> = {
    app_settings: ['ai_system_prompt', 'risk_note'],
    app_automations: ['native_action', 'last_run_id', 'schedule_id', 'schedule_status', 'schedule_error', 'next_run_at'],
    run_history: ['status', 'summary', 'failure_reason'],
    assistant_messages: ['role', 'text'],
    app_notifications: ['channel', 'status', 'last_error', 'last_message_id'],
    app_command_runs: ['command', 'risk_level', 'confirmation_required', 'last_run_id'],
    acceptance_checks: ['acceptance_id', 'done', 'status', 'evidence', 'failure_reason', 'evidence_run_id'],
    reply_drafts: ['draft_text', 'status', 'confirmation_channel', 'confirmation_code', 'confirmation_expires_at'],
  };
  const collections = new Map(
    (dataSchema?.collections ?? [])
      .filter((collection) => isString(collection.name))
      .map((collection) => [
        collection.name as string,
        new Set((collection.fields ?? []).map((field) => field.name).filter(isString)),
      ]),
  );
  const failures: string[] = [];
  for (const [collection, fields] of Object.entries(required)) {
    const actual = collections.get(collection);
    if (!actual) continue;
    const missing = fields.filter((field) => !actual.has(field));
    if (missing.length > 0) {
      failures.push(`${collection} 缺少字段 ${missing.join(', ')}`);
    }
  }
  return failures;
}
