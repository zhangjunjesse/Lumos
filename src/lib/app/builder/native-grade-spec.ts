import type { ValidationIssue } from '@/lib/app/manifest/types';

export const NATIVE_APP_SPEC_FILE = 'native-app-spec.json';

export interface NativeGradeValidationContext {
  usesAi?: boolean;
  workflowIds?: string[];
  usesDeepSearch?: boolean;
  usesIm?: boolean;
}

type NativeGradeSpec = {
  version?: unknown;
  summary?: unknown;
  userVisibleScope?: unknown;
  status?: {
    states?: unknown;
    readyCriteria?: unknown;
    notConnectedBehavior?: unknown;
  };
  settings?: unknown;
  data?: {
    entities?: unknown;
    reusableStores?: unknown;
  };
  ai?: {
    enabled?: unknown;
    promptSettings?: unknown;
    draftBeforeWrite?: unknown;
    visibleFailureHandling?: unknown;
  };
  automations?: {
    enabled?: unknown;
    controls?: unknown;
    visibleRunResults?: unknown;
  };
  runResults?: {
    visible?: unknown;
    states?: unknown;
    failureReasons?: unknown;
    retry?: unknown;
  };
  im?: {
    enabled?: unknown;
    lowRiskCommands?: unknown;
    confirmationRequiredFor?: unknown;
    visibleCommandResults?: unknown;
  };
  risk?: {
    writeActionsRequireConfirmation?: unknown;
    highRiskActions?: unknown;
    outOfScope?: unknown;
  };
  acceptance?: unknown;
};

const REQUIRED_STATUS_STATES = ['not_configured', 'ready', 'failed', 'not_connected'];
const REQUIRED_RUN_STATES = ['running', 'success', 'failed', 'cancelled'];
const REQUIRED_AUTOMATION_CONTROLS = ['run_now', 'edit', 'delete'];

export function validateNativeGradeAppSpec(
  fileMap: Map<string, string>,
  context: NativeGradeValidationContext = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const content = fileMap.get(NATIVE_APP_SPEC_FILE);
  if (!content) {
    return [{
      level: 'error',
      file: NATIVE_APP_SPEC_FILE,
      jsonPath: '/',
      message: '缺少内置级应用规格 native-app-spec.json。',
      hint: "调用 read_schema('native-app-spec') 后生成规格；必须说明用户可见范围、状态、设置、AI/自动化/IM、风险和验收清单。",
    }];
  }

  let spec: NativeGradeSpec;
  try {
    spec = JSON.parse(content) as NativeGradeSpec;
  } catch (error) {
    return [{
      level: 'error',
      file: NATIVE_APP_SPEC_FILE,
      jsonPath: '/',
      message: `native-app-spec.json 不是合法 JSON：${(error as Error).message}`,
    }];
  }

  if (spec.version !== 1) {
    issues.push(issue('/version', 'native-app-spec.json 的 version 必须是 1。'));
  }
  if (!isMeaningfulString(spec.summary, 8)) {
    issues.push(issue('/summary', '内置级应用规格必须提供面向用户的应用摘要。'));
  }
  if (!isStringArray(spec.userVisibleScope, 2)) {
    issues.push(issue('/userVisibleScope', '必须列出至少 2 条用户今天能打开、配置、运行或验证的可见范围。'));
  }

  const statusStates = asStringArray(spec.status?.states);
  for (const state of REQUIRED_STATUS_STATES) {
    if (!statusStates.includes(state)) {
      issues.push(issue('/status/states', `状态合同必须包含 ${state}。`));
    }
  }
  if (!statusStates.includes('running') && !statusStates.includes('syncing')) {
    issues.push(issue('/status/states', '状态合同必须包含 running 或 syncing，用于展示后台执行中状态。'));
  }
  if (!isStringArray(spec.status?.readyCriteria, 1)) {
    issues.push(issue('/status/readyCriteria', '必须写清应用显示“已就绪”的判定条件。'));
  }
  if (!isMeaningfulString(spec.status?.notConnectedBehavior, 8)) {
    issues.push(issue('/status/notConnectedBehavior', '必须说明缺底层能力或未接入能力时的 UI 行为。'));
  }

  if (!Array.isArray(spec.settings) || spec.settings.length === 0) {
    issues.push(issue('/settings', '必须声明至少一个用户可见设置分组。'));
  }

  const entities = asStringArray(spec.data?.entities);
  const reusableStores = asStringArray(spec.data?.reusableStores);
  for (const [entity, reason] of [
    ['app_settings', '保存应用设置'],
    ['app_automations', '保存自动化定义和未接入状态'],
    ['run_history', '展示运行结果'],
    ['assistant_messages', '保存应用 AI 助手对话'],
    ['app_notifications', '保存 IM / 系统通知目标和发送状态'],
    ['app_command_runs', '保存 IM 命令模板、确认边界和执行结果'],
    ['acceptance_checks', '保存用户验收清单进度'],
  ] as const) {
    if (!entities.includes(entity)) {
      issues.push(issue('/data/entities', `通用数据合同必须包含 ${entity}，用于${reason}。`));
    }
  }
  if (!reusableStores.includes('settings')) {
    issues.push(issue('/data/reusableStores', '通用数据合同必须包含 settings。'));
  }
  if (!reusableStores.includes('run_history')) {
    issues.push(issue('/data/reusableStores', '通用数据合同必须包含 run_history，用于展示运行结果。'));
  }

  const runStates = asStringArray(spec.runResults?.states);
  if (spec.runResults?.visible !== true) {
    issues.push(issue('/runResults/visible', '内置级应用必须有可见运行结果区域。'));
  }
  for (const state of REQUIRED_RUN_STATES) {
    if (!runStates.includes(state)) {
      issues.push(issue('/runResults/states', `运行结果必须覆盖 ${state} 状态。`));
    }
  }
  if (spec.runResults?.failureReasons !== true || spec.runResults.retry !== true) {
    issues.push(issue('/runResults', '运行结果必须展示失败原因，并提供重试能力或重试说明。'));
  }

  if (spec.risk?.writeActionsRequireConfirmation !== true) {
    issues.push(issue('/risk/writeActionsRequireConfirmation', '写操作必须默认要求用户确认。'));
  }

  if (!Array.isArray(spec.acceptance) || spec.acceptance.length < 5) {
    issues.push(issue('/acceptance', '验收清单至少需要 5 项可由用户在 UI 中验证的路径。'));
  }

  if (context.usesAi) {
    if (spec.ai?.enabled !== true) {
      issues.push(issue('/ai/enabled', '应用调用 AI 能力时，native-app-spec.json 必须声明 ai.enabled=true。'));
    }
    if (
      spec.ai?.promptSettings !== true
      || spec.ai.visibleFailureHandling !== true
      || spec.ai.draftBeforeWrite !== true
    ) {
      issues.push(issue('/ai', '应用调用 AI 能力时，必须声明提示词设置、失败处理，以及写操作先草稿后确认。'));
    }
  }

  if ((context.workflowIds?.length ?? 0) > 0) {
    const controls = asStringArray(spec.automations?.controls);
    if (spec.automations?.visibleRunResults !== true) {
      issues.push(issue('/automations/visibleRunResults', '应用调用 Workflow 时，必须声明可见运行结果。'));
    }
    for (const control of REQUIRED_AUTOMATION_CONTROLS) {
      if (!controls.includes(control)) {
        issues.push(issue('/automations/controls', `应用调用 Workflow 时，自动化/运行控制必须包含 ${control}。`));
      }
    }
  }

  if (context.usesDeepSearch) {
    const scopeText = asStringArray(spec.userVisibleScope).join('\n');
    const acceptanceText = JSON.stringify(spec.acceptance ?? []);
    if (!/DeepSearch|深度搜索|证据|资料源/i.test(`${scopeText}\n${acceptanceText}`)) {
      issues.push(issue('/acceptance', '应用调用 DeepSearch 时，用户可见范围或验收清单必须说明资料源、证据或深度搜索结果。'));
    }
  }

  if (context.usesIm) {
    const scopeText = asStringArray(spec.userVisibleScope).join('\n');
    const acceptanceText = JSON.stringify(spec.acceptance ?? []);
    if (spec.im?.enabled !== true || spec.im.visibleCommandResults !== true) {
      issues.push(issue('/im', '应用调用 IM 能力时，native-app-spec.json 必须声明 im.enabled=true，并展示通知/命令结果。'));
    }
    if (!/IM|微信|通知|主 Agent|Main Agent/i.test(`${scopeText}\n${acceptanceText}`)) {
      issues.push(issue('/acceptance', '应用调用 IM 能力时，用户可见范围或验收清单必须说明微信通知和用户回复进入主 Agent 的路径。'));
    }
  }

  return issues;
}

function issue(jsonPath: string, message: string): ValidationIssue {
  return {
    level: 'error',
    file: NATIVE_APP_SPEC_FILE,
    jsonPath,
    message,
  };
}

function isMeaningfulString(value: unknown, minLength: number): value is string {
  return typeof value === 'string' && value.trim().length >= minLength;
}

function isStringArray(value: unknown, minItems: number): value is string[] {
  return Array.isArray(value)
    && value.length >= minItems
    && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
