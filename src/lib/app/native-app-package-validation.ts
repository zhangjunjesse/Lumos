import fs from 'fs';
import path from 'path';

import type { ValidationIssue } from './manifest/types';

const REQUIRED_NATIVE_MENU_IDS = ['status', 'settings', 'automations', 'im', 'run-history'];
const REQUIRED_STATUS_STATES = ['not_configured', 'ready', 'failed', 'not_connected'];
const REQUIRED_RUN_STATES = ['running', 'success', 'failed', 'cancelled'];
const REQUIRED_COMMON_ENTITIES = ['app_settings', 'app_automations', 'run_history', 'assistant_messages', 'app_notifications', 'app_command_runs', 'acceptance_checks'];

const REQUIRED_COLLECTION_FIELDS: Record<string, string[]> = {
  app_settings: ['ai_system_prompt', 'risk_note'],
  app_automations: ['native_action', 'last_run_id', 'schedule_id', 'schedule_status', 'schedule_error', 'next_run_at'],
  run_history: ['status', 'summary', 'failure_reason'],
  assistant_messages: ['role', 'text'],
  app_notifications: ['channel', 'status', 'last_error', 'last_message_id'],
  app_command_runs: ['command', 'risk_level', 'confirmation_required', 'last_run_id'],
  acceptance_checks: ['acceptance_id', 'done', 'status', 'evidence', 'failure_reason', 'evidence_run_id'],
  reply_drafts: ['draft_text', 'status', 'confirmation_channel', 'confirmation_code', 'confirmation_expires_at'],
};

export interface NativeAppPackageValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

type IssueAdder = (file: string, message: string, jsonPath?: string, level?: ValidationIssue['level']) => void;

export function validateNativeAppPackageDirectory(rootPath: string): NativeAppPackageValidationResult {
  const absoluteRoot = path.resolve(rootPath);
  const files = collectFiles(absoluteRoot);
  if (!fs.existsSync(absoluteRoot)) {
    return result([issue(absoluteRoot, '应用目录不存在。')]);
  }
  return validateNativeAppPackageFiles(files);
}

export function validateNativeAppPackageFiles(inputFiles: Map<string, string> | Record<string, string>): NativeAppPackageValidationResult {
  const files = inputFiles instanceof Map ? inputFiles : new Map(Object.entries(inputFiles));
  const issues: ValidationIssue[] = [];
  const add: IssueAdder = (file, message, jsonPath = '/', level = 'error') => {
    issues.push({ level, file, jsonPath, message });
  };

  if (files.has('manifest.json') && !files.has('app.json')) {
    add('manifest.json', '检测到普通 React 应用包 manifest.json，但内置级应用必须使用 app.json + routes.json + native-app-spec.json。');
  }
  for (const file of ['app.json', 'routes.json', 'data-schema.json', 'native-app-spec.json']) {
    if (!files.has(file)) add(file, `缺少 ${file}。`);
  }

  const app = readJson(files, 'app.json', add);
  const routes = readJson(files, 'routes.json', add);
  const dataSchema = readJson(files, 'data-schema.json', add);
  const spec = readJson(files, 'native-app-spec.json', add);

  validateNativeSpec(spec, add);
  validateRoutes(routes, files, add);
  validateDataSchema(dataSchema, spec, add);
  validateNativeShellPages(files, spec, add);
  validateManifestPermissions(app, spec, add);

  return result(issues);
}

function validateNativeSpec(spec: unknown, add: IssueAdder): void {
  if (!isRecord(spec)) return;
  if (spec.version !== 1) add('native-app-spec.json', 'version 必须是 1。', '/version');
  if (!meaningfulString(spec.summary, 8)) {
    add('native-app-spec.json', '必须提供面向用户的应用摘要。', '/summary');
  }
  if (!stringArray(spec.userVisibleScope, 2)) {
    add('native-app-spec.json', 'userVisibleScope 至少需要 2 条用户可见验收范围。', '/userVisibleScope');
  }

  const status = asRecord(spec.status);
  const statusStates = toStringArray(status?.states);
  for (const state of REQUIRED_STATUS_STATES) {
    if (!statusStates.includes(state)) {
      add('native-app-spec.json', `状态合同必须包含 ${state}。`, '/status/states');
    }
  }
  if (!statusStates.includes('running') && !statusStates.includes('syncing')) {
    add('native-app-spec.json', '状态合同必须包含 running 或 syncing。', '/status/states');
  }
  if (!stringArray(status?.readyCriteria, 1)) {
    add('native-app-spec.json', 'readyCriteria 至少需要 1 条。', '/status/readyCriteria');
  }
  if (!meaningfulString(status?.notConnectedBehavior, 8)) {
    add('native-app-spec.json', '必须说明缺底层能力时的 UI 行为。', '/status/notConnectedBehavior');
  }

  if (!Array.isArray(spec.settings) || spec.settings.length === 0) {
    add('native-app-spec.json', '必须声明至少一个用户可见设置分组。', '/settings');
  }
  const data = asRecord(spec.data);
  for (const entity of REQUIRED_COMMON_ENTITIES) {
    if (!toStringArray(data?.entities).includes(entity)) {
      add('native-app-spec.json', `data.entities 必须包含 ${entity}。`, '/data/entities');
    }
  }
  if (!toStringArray(data?.reusableStores).includes('settings')) {
    add('native-app-spec.json', 'data.reusableStores 必须包含 settings。', '/data/reusableStores');
  }
  if (!toStringArray(data?.reusableStores).includes('run_history')) {
    add('native-app-spec.json', 'data.reusableStores 必须包含 run_history。', '/data/reusableStores');
  }

  const runResults = asRecord(spec.runResults);
  if (runResults?.visible !== true) {
    add('native-app-spec.json', 'runResults.visible 必须为 true。', '/runResults/visible');
  }
  const runStates = toStringArray(runResults?.states);
  for (const state of REQUIRED_RUN_STATES) {
    if (!runStates.includes(state)) {
      add('native-app-spec.json', `运行结果必须覆盖 ${state} 状态。`, '/runResults/states');
    }
  }
  if (runResults?.failureReasons !== true || runResults?.retry !== true) {
    add('native-app-spec.json', '运行结果必须展示失败原因，并提供重试能力或说明。', '/runResults');
  }
  if (asRecord(spec.risk)?.writeActionsRequireConfirmation !== true) {
    add('native-app-spec.json', '写操作必须默认要求用户确认。', '/risk/writeActionsRequireConfirmation');
  }
  const acceptance = Array.isArray(spec.acceptance) ? spec.acceptance : [];
  if (acceptance.length < 5) {
    add('native-app-spec.json', '验收清单至少需要 5 项。', '/acceptance');
  }
  const acceptanceIds = new Set(acceptance.map((item) => asRecord(item)?.id).filter(isString));
  if (!acceptanceIds.has('installation-self-check')) {
    add('native-app-spec.json', '验收清单必须包含 installation-self-check。', '/acceptance');
  }
}

function validateRoutes(routes: unknown, files: Map<string, string>, add: IssueAdder): void {
  if (!isRecord(routes)) return;
  const menu = Array.isArray(routes.menu) ? routes.menu : [];
  if (menu.length === 0) add('routes.json', 'menu 至少需要 1 项。', '/menu');
  const menuIds = new Set(menu.map((item) => asRecord(item)?.id).filter(isString));
  if (isString(routes.default) && !menuIds.has(routes.default)) {
    add('routes.json', `default 指向的菜单 ${routes.default} 不存在。`, '/default');
  }
  for (const id of REQUIRED_NATIVE_MENU_IDS) {
    if (!menuIds.has(id)) add('routes.json', `缺少内置级通用菜单 ${id}。`, '/menu');
  }
  for (const raw of menu) {
    const item = asRecord(raw);
    if (!item) continue;
    if (isString(item.component)) {
      add('routes.json', `菜单 ${item.id ?? '?'} 使用 component；当前内置级生成器应使用声明式 pages/*.json。`, '/menu');
    }
    if (isString(item.page) && !files.has(item.page)) {
      add('routes.json', `菜单 ${item.id ?? '?'} 引用的页面文件不存在：${item.page}。`, '/menu');
    }
  }
}

function validateDataSchema(dataSchema: unknown, spec: unknown, add: IssueAdder): void {
  if (!isRecord(dataSchema)) return;
  const collections = Array.isArray(dataSchema.collections) ? dataSchema.collections : [];
  const collectionFields = new Map<string, Set<string>>();
  for (const raw of collections) {
    const collection = asRecord(raw);
    if (!isString(collection?.name)) continue;
    const fields = Array.isArray(collection.fields) ? collection.fields : [];
    collectionFields.set(
      collection.name,
      new Set(fields.map((field) => asRecord(field)?.name).filter(isString)),
    );
  }

  for (const entity of toStringArray(asRecord(asRecord(spec)?.data)?.entities)) {
    if (!collectionFields.has(entity)) {
      add('data-schema.json', `规格声明的数据集合未落到 data-schema：${entity}。`, '/collections');
    }
  }
  for (const [collection, fields] of Object.entries(REQUIRED_COLLECTION_FIELDS)) {
    const actual = collectionFields.get(collection);
    if (!actual) continue;
    const missing = fields.filter((field) => !actual.has(field));
    if (missing.length > 0) {
      add('data-schema.json', `${collection} 缺少字段 ${missing.join(', ')}。`, '/collections');
    }
  }
}

function validateNativeShellPages(files: Map<string, string>, spec: unknown, add: IssueAdder): void {
  checkPage(files, add, 'pages/status.json', ['native:app:run-self-check'], '状态页必须包含重新运行安装自检入口。');
  checkPage(files, add, 'pages/settings.json', ['ai_system_prompt', 'risk_note'], '设置页必须包含 AI 提示词和风险边界。');
  checkPage(files, add, 'pages/automations.json', ['native:app:run-automation', 'native:app:sync-automation-schedule'], '自动化页必须包含立即运行和同步定时任务入口。');
  checkPage(files, add, 'pages/im.json', ['native:app:run-command'], '通知命令页必须包含命令测试入口。');
  checkPage(files, add, 'pages/im.json', ['/app', 'status', 'runs', 'acceptance', 'help'], '通知命令页必须说明 /app 通用只读命令。');
  checkPage(files, add, 'pages/run-history.json', ['failure_reason'], '运行结果页必须展示失败原因字段。');

  const imPage = files.get('pages/im.json') ?? '';
  for (const command of toStringArray(asRecord(asRecord(spec)?.im)?.lowRiskCommands)) {
    const needle = command.replace(/\s+<[^>]+>/g, '').trim();
    if (needle && !imPage.includes(needle)) {
      add('pages/im.json', `通知命令页缺少规格声明的低风险命令入口：${command}。`);
    }
  }

  const entities = toStringArray(asRecord(asRecord(spec)?.data)?.entities);
  if (entities.includes('buyer_conversations') && entities.includes('reply_drafts')) {
    checkPage(files, add, 'pages/inbox.json', ['native:goofish:generate-reply-draft'], '闲鱼会话页必须包含生成回复草稿入口。');
    checkPage(files, add, 'pages/drafts.json', ['native:goofish:send-draft', 'native:goofish:reject-draft'], '回复草稿页必须包含确认发送和拒绝草稿入口。');
  }
}

function validateManifestPermissions(app: unknown, spec: unknown, add: IssueAdder): void {
  if (!isRecord(app)) return;
  const permissions = asRecord(app.permissions);
  const systemPermissions = toStringArray(permissions?.system);
  if (permissions?.data !== 'isolated') {
    add('app.json', '内置级用户生成应用必须使用 permissions.data = isolated。', '/permissions/data');
  }
  if (asRecord(spec)?.automations && asRecord(asRecord(spec)?.automations)?.enabled === true && !systemPermissions.includes('schedule')) {
    add('app.json', 'native-app-spec 声明 automations.enabled=true，但 app.json 未声明 system.schedule。', '/permissions/system');
  }
  if (asRecord(spec)?.im && asRecord(asRecord(spec)?.im)?.enabled === true && !systemPermissions.includes('im-notification')) {
    add('app.json', 'native-app-spec 声明 im.enabled=true，但 app.json 未声明 system.im-notification。', '/permissions/system');
  }
}

function checkPage(files: Map<string, string>, add: IssueAdder, file: string, needles: string[], message: string): void {
  const content = files.get(file);
  if (!content) {
    add(file, `缺少 ${file}。`);
    return;
  }
  const missing = needles.filter((needle) => !content.includes(needle));
  if (missing.length > 0) add(file, `${message} 缺少：${missing.join(', ')}。`);
}

function collectFiles(rootPath: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!fs.existsSync(rootPath)) return files;
  walk(rootPath, (filePath) => {
    const rel = path.relative(rootPath, filePath).split(path.sep).join(path.posix.sep);
    files.set(rel, fs.readFileSync(filePath, 'utf-8'));
  });
  return files;
}

function walk(dir: string, visit: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

function readJson(files: Map<string, string>, file: string, add: IssueAdder): unknown {
  const content = files.get(file);
  if (!content) return null;
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    add(file, `JSON 解析失败：${(error as Error).message}`);
    return null;
  }
}

function result(issues: ValidationIssue[]): NativeAppPackageValidationResult {
  const errors = issues.filter((item) => item.level === 'error');
  return { ok: errors.length === 0, issues, errorCount: errors.length, warningCount: issues.length - errors.length };
}

function issue(file: string, message: string, jsonPath = '/'): ValidationIssue {
  return { level: 'error', file, jsonPath, message };
}

function meaningfulString(value: unknown, minLength: number): value is string {
  return typeof value === 'string' && value.trim().length >= minLength;
}

function stringArray(value: unknown, minLength: number): value is string[] {
  return Array.isArray(value) && value.filter((item) => typeof item === 'string' && item.trim()).length >= minLength;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
