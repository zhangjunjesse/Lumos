#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REQUIRED_NATIVE_MENU_IDS = ['status', 'settings', 'automations', 'im', 'run-history'];
const REQUIRED_STATUS_STATES = ['not_configured', 'ready', 'failed', 'not_connected'];
const REQUIRED_RUN_STATES = ['running', 'success', 'failed', 'cancelled'];
const REQUIRED_COMMON_ENTITIES = [
  'app_settings',
  'app_automations',
  'run_history',
  'assistant_messages',
  'app_notifications',
  'app_command_runs',
  'acceptance_checks',
];
const REQUIRED_COLLECTION_FIELDS = {
  app_settings: ['ai_system_prompt', 'risk_note'],
  app_automations: ['native_action', 'last_run_id', 'schedule_id', 'schedule_status', 'schedule_error', 'next_run_at'],
  run_history: ['status', 'summary', 'failure_reason'],
  assistant_messages: ['role', 'text'],
  app_notifications: ['channel', 'status', 'last_error', 'last_message_id'],
  app_command_runs: ['command', 'risk_level', 'confirmation_required', 'last_run_id'],
  acceptance_checks: ['acceptance_id', 'done', 'status', 'evidence', 'failure_reason', 'evidence_run_id'],
  reply_drafts: ['draft_text', 'status', 'confirmation_channel', 'confirmation_code', 'confirmation_expires_at'],
};

export function validateNativeAppDirectory(rootPath) {
  const absoluteRoot = path.resolve(rootPath);
  const files = collectFiles(absoluteRoot);
  return validateNativeAppFiles(files, { rootPath: absoluteRoot });
}

export function validateNativeAppFiles(files, options = {}) {
  const issues = [];
  const add = (file, message, jsonPath = '/', level = 'error') => {
    issues.push({ level, file, jsonPath, message });
  };

  if (options.rootPath && !fs.existsSync(options.rootPath)) {
    add(options.rootPath, '应用目录不存在。');
    return result(issues);
  }
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

function validateNativeSpec(spec, add) {
  if (!spec) return;
  if (spec.version !== 1) {
    add('native-app-spec.json', 'version 必须是 1。', '/version');
  }
  if (!meaningfulString(spec.summary, 8)) {
    add('native-app-spec.json', '必须提供面向用户的应用摘要。', '/summary');
  }
  if (!stringArray(spec.userVisibleScope, 2)) {
    add('native-app-spec.json', 'userVisibleScope 至少需要 2 条用户可见验收范围。', '/userVisibleScope');
  }

  const statusStates = toStringArray(spec.status?.states);
  for (const state of REQUIRED_STATUS_STATES) {
    if (!statusStates.includes(state)) {
      add('native-app-spec.json', `状态合同必须包含 ${state}。`, '/status/states');
    }
  }
  if (!statusStates.includes('running') && !statusStates.includes('syncing')) {
    add('native-app-spec.json', '状态合同必须包含 running 或 syncing。', '/status/states');
  }
  if (!stringArray(spec.status?.readyCriteria, 1)) {
    add('native-app-spec.json', 'readyCriteria 至少需要 1 条。', '/status/readyCriteria');
  }
  if (!meaningfulString(spec.status?.notConnectedBehavior, 8)) {
    add('native-app-spec.json', '必须说明缺底层能力时的 UI 行为。', '/status/notConnectedBehavior');
  }

  if (!Array.isArray(spec.settings) || spec.settings.length === 0) {
    add('native-app-spec.json', '必须声明至少一个用户可见设置分组。', '/settings');
  }
  for (const entity of REQUIRED_COMMON_ENTITIES) {
    if (!toStringArray(spec.data?.entities).includes(entity)) {
      add('native-app-spec.json', `data.entities 必须包含 ${entity}。`, '/data/entities');
    }
  }
  if (!toStringArray(spec.data?.reusableStores).includes('settings')) {
    add('native-app-spec.json', 'data.reusableStores 必须包含 settings。', '/data/reusableStores');
  }
  if (!toStringArray(spec.data?.reusableStores).includes('run_history')) {
    add('native-app-spec.json', 'data.reusableStores 必须包含 run_history。', '/data/reusableStores');
  }

  if (spec.runResults?.visible !== true) {
    add('native-app-spec.json', 'runResults.visible 必须为 true。', '/runResults/visible');
  }
  const runStates = toStringArray(spec.runResults?.states);
  for (const state of REQUIRED_RUN_STATES) {
    if (!runStates.includes(state)) {
      add('native-app-spec.json', `运行结果必须覆盖 ${state} 状态。`, '/runResults/states');
    }
  }
  if (spec.runResults?.failureReasons !== true || spec.runResults?.retry !== true) {
    add('native-app-spec.json', '运行结果必须展示失败原因，并提供重试能力或说明。', '/runResults');
  }
  if (spec.risk?.writeActionsRequireConfirmation !== true) {
    add('native-app-spec.json', '写操作必须默认要求用户确认。', '/risk/writeActionsRequireConfirmation');
  }
  if (!Array.isArray(spec.acceptance) || spec.acceptance.length < 5) {
    add('native-app-spec.json', '验收清单至少需要 5 项。', '/acceptance');
  }
  const acceptanceIds = new Set((spec.acceptance ?? []).map((item) => item?.id).filter(isString));
  if (!acceptanceIds.has('installation-self-check')) {
    add('native-app-spec.json', '验收清单必须包含 installation-self-check。', '/acceptance');
  }
}

function validateRoutes(routes, files, add) {
  if (!routes) return;
  const menu = Array.isArray(routes.menu) ? routes.menu : [];
  if (menu.length === 0) {
    add('routes.json', 'menu 至少需要 1 项。', '/menu');
  }
  const menuIds = new Set(menu.map((item) => item?.id).filter(isString));
  if (isString(routes.default) && !menuIds.has(routes.default)) {
    add('routes.json', `default 指向的菜单 ${routes.default} 不存在。`, '/default');
  }
  for (const id of REQUIRED_NATIVE_MENU_IDS) {
    if (!menuIds.has(id)) {
      add('routes.json', `缺少内置级通用菜单 ${id}。`, '/menu');
    }
  }
  for (const item of menu) {
    if (isString(item?.component)) {
      add('routes.json', `菜单 ${item.id ?? '?'} 使用 component；当前内置级生成器应使用声明式 pages/*.json。`, '/menu');
    }
    if (isString(item?.page) && !files.has(item.page)) {
      add('routes.json', `菜单 ${item.id ?? '?'} 引用的页面文件不存在：${item.page}。`, '/menu');
    }
  }
}

function validateDataSchema(dataSchema, spec, add) {
  if (!dataSchema) return;
  const collections = Array.isArray(dataSchema.collections) ? dataSchema.collections : [];
  const collectionFields = new Map(collections
    .filter((collection) => isString(collection?.name))
    .map((collection) => [
      collection.name,
      new Set((collection.fields ?? []).map((field) => field?.name).filter(isString)),
    ]));
  for (const entity of toStringArray(spec?.data?.entities)) {
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

function validateNativeShellPages(files, spec, add) {
  checkPage(files, add, 'pages/status.json', ['native:app:run-self-check'], '状态页必须包含重新运行安装自检入口。');
  checkPage(files, add, 'pages/settings.json', ['ai_system_prompt', 'risk_note'], '设置页必须包含 AI 提示词和风险边界。');
  checkPage(
    files,
    add,
    'pages/automations.json',
    ['native:app:run-automation', 'native:app:sync-automation-schedule'],
    '自动化页必须包含立即运行和同步定时任务入口。',
  );
  checkPage(files, add, 'pages/im.json', ['native:app:run-command'], '通知命令页必须包含命令测试入口。');
  checkPage(files, add, 'pages/im.json', ['/app', 'status', 'runs', 'acceptance', 'help'], '通知命令页必须说明 /app 通用只读命令。');
  checkPage(files, add, 'pages/run-history.json', ['failure_reason'], '运行结果页必须展示失败原因字段。');

  const imPage = files.get('pages/im.json') ?? '';
  for (const command of toStringArray(spec?.im?.lowRiskCommands)) {
    const needle = command.replace(/\s+<[^>]+>/g, '').trim();
    if (needle && !imPage.includes(needle)) {
      add('pages/im.json', `通知命令页缺少规格声明的低风险命令入口：${command}。`);
    }
  }

  const entities = toStringArray(spec?.data?.entities);
  if (entities.includes('buyer_conversations') && entities.includes('reply_drafts')) {
    checkPage(files, add, 'pages/inbox.json', ['native:goofish:generate-reply-draft'], '闲鱼会话页必须包含生成回复草稿入口。');
    checkPage(
      files,
      add,
      'pages/drafts.json',
      ['native:goofish:send-draft', 'native:goofish:reject-draft'],
      '回复草稿页必须包含确认发送和拒绝草稿入口。',
    );
  }
}

function validateManifestPermissions(app, spec, add) {
  if (!app) return;
  const systemPermissions = toStringArray(app.permissions?.system);
  if (app.permissions?.data !== 'isolated') {
    add('app.json', '内置级用户生成应用必须使用 permissions.data = isolated。', '/permissions/data');
  }
  if (spec?.automations?.enabled === true && !systemPermissions.includes('schedule')) {
    add('app.json', 'native-app-spec 声明 automations.enabled=true，但 app.json 未声明 system.schedule。', '/permissions/system');
  }
  if (spec?.im?.enabled === true && !systemPermissions.includes('im-notification')) {
    add('app.json', 'native-app-spec 声明 im.enabled=true，但 app.json 未声明 system.im-notification。', '/permissions/system');
  }
}

function checkPage(files, add, file, needles, message) {
  const content = files.get(file);
  if (!content) {
    add(file, `缺少 ${file}。`);
    return;
  }
  const missing = needles.filter((needle) => !content.includes(needle));
  if (missing.length > 0) {
    add(file, `${message} 缺少：${missing.join(', ')}。`);
  }
}

function collectFiles(rootPath) {
  const files = new Map();
  if (!fs.existsSync(rootPath)) return files;
  walk(rootPath, (filePath) => {
    const rel = path.relative(rootPath, filePath).split(path.sep).join(path.posix.sep);
    files.set(rel, fs.readFileSync(filePath, 'utf-8'));
  });
  return files;
}

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

function readJson(files, file, add) {
  const content = files.get(file);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (error) {
    add(file, `JSON 解析失败：${error.message}`);
    return null;
  }
}

function result(issues) {
  const errors = issues.filter((issue) => issue.level === 'error');
  return {
    ok: errors.length === 0,
    issues,
    errorCount: errors.length,
    warningCount: issues.length - errors.length,
  };
}

function meaningfulString(value, minLength) {
  return typeof value === 'string' && value.trim().length >= minLength;
}

function stringArray(value, minLength) {
  return Array.isArray(value)
    && value.filter((item) => typeof item === 'string' && item.trim()).length >= minLength;
}

function toStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : [];
}

function isString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function printHuman(validation, appDir) {
  if (validation.ok) {
    console.log(`Native app validation passed: ${appDir}`);
    return;
  }
  console.error(`Native app validation failed: ${appDir}`);
  for (const issue of validation.issues) {
    console.error(`- ${issue.file} ${issue.jsonPath}: ${issue.message}`);
  }
}

function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const appDir = args.find((arg) => !arg.startsWith('--'));
  if (!appDir) {
    console.error('Usage: npm run validate:native-app -- <app-dir> [--json]');
    process.exitCode = 2;
    return;
  }
  const validation = validateNativeAppDirectory(appDir);
  if (json) {
    console.log(JSON.stringify(validation, null, 2));
  } else {
    printHuman(validation, appDir);
  }
  if (!validation.ok) {
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main(process.argv);
}
