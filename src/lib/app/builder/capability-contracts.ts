import type { ValidationIssue } from '@/lib/app/manifest/types';
import { validateNativeGradeAppSpec } from './native-grade-spec';

type ManifestCapabilityShape = {
  routes?: Array<{ id?: string; path?: string; page?: string; label?: string; hidden?: boolean }>;
  permissions?: {
    ai?: { complete?: boolean; stream?: boolean; structured?: boolean };
    workflow?: { run?: string[] };
    deepsearch?: { start?: boolean; read?: boolean; control?: boolean };
    system?: string[];
  };
};

export function validateAppCapabilityContracts(fileMap: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const manifest = parseManifestForCapabilityCheck(fileMap.get('manifest.json'));
  const sourceFiles = Array.from(fileMap.entries())
    .filter(([path]) => /\.(tsx|ts|jsx|js)$/.test(path));
  const allCode = sourceFiles.map(([, content]) => content).join('\n');

  if (/\bai\.stream\s*\(/.test(allCode)) {
    issues.push({
      level: 'error',
      file: firstSourceUsing(sourceFiles, /\bai\.stream\s*\(/) ?? 'pages/index.tsx',
      jsonPath: '/',
      message: '当前应用运行时不要默认使用 ai.stream()；请改用 ai.complete()，并提供 loading 状态。',
      hint: '同时在 manifest.permissions.ai 加入 { "complete": true }，并提供可见的 Agent/AI 设置入口。',
    });
  }

  if (/\bai\.structured\s*\(/.test(allCode)) {
    issues.push({
      level: 'error',
      file: firstSourceUsing(sourceFiles, /\bai\.structured\s*\(/) ?? 'pages/index.tsx',
      jsonPath: '/',
      message: '当前应用运行时 ai.structured() 尚未稳定接入；请改用 ai.complete() 后在应用内解析或展示文本结果.',
    });
  }

  const usesAiComplete = /\bai\.complete\s*\(/.test(allCode);
  if (usesAiComplete && !manifest?.permissions?.ai?.complete) {
    issues.push({
      level: 'error',
      file: 'manifest.json',
      jsonPath: '/permissions/ai/complete',
      message: '应用代码调用了 ai.complete()，但 manifest 没有声明 permissions.ai.complete。',
      hint: '在 manifest.permissions 加入 "ai": { "complete": true }，并提供可见的 AI/Agent 设置入口。',
    });
  }
  if (usesAiComplete) {
    issues.push(...validateAiManagementUi(fileMap, manifest));
  }

  const workflowIds = extractCallStringLiterals(allCode, /\bworkflow\.run\s*\(\s*['"`]([^'"`]+)['"`]/g);
  for (const workflowId of workflowIds) {
    const allowed = Array.isArray(manifest?.permissions?.workflow?.run)
      && manifest.permissions.workflow.run.includes(workflowId);
    if (!allowed) {
      issues.push({
        level: 'error',
        file: 'manifest.json',
        jsonPath: '/permissions/workflow/run',
        message: `应用代码调用了 workflow.run("${workflowId}")，但 manifest 没有声明对应运行权限。`,
        hint: `在 manifest.permissions.workflow.run 加入 "${workflowId}"，并提供可见的工作流管理/运行状态入口。`,
      });
    }
    if (!fileMap.has(`workflows/${workflowId}.json`)) {
      issues.push({
        level: 'error',
        file: `workflows/${workflowId}.json`,
        jsonPath: '/',
        message: `应用代码调用了 workflow.run("${workflowId}")，但没有内置 workflows/${workflowId}.json。`,
        hint: `写入 workflows/${workflowId}.json，或移除 workflow.run("${workflowId}")，不要只写一个看不见的外部工作流名字。`,
      });
    }
  }
  if (workflowIds.length > 0) {
    issues.push(...validateWorkflowManagementUi(fileMap, manifest, workflowIds));
  }

  const usesDeepSearch = /\bdeepsearch\.(start|getResult|pause|resume|cancel)\s*\(/.test(allCode);
  if (usesDeepSearch && !manifest?.permissions?.deepsearch) {
    issues.push({
      level: 'error',
      file: 'manifest.json',
      jsonPath: '/permissions/deepsearch',
      message: '应用代码调用了 deepsearch.*，但 manifest 没有声明 DeepSearch 权限。',
      hint: '按实际调用加入 permissions.deepsearch.start/read/control，并提供 DeepSearch 配置、运行状态、结果证据和重试入口。',
    });
  }
  if (usesDeepSearch) {
    issues.push(...validateDeepSearchManagementUi(fileMap, manifest));
  }

  const usesImNotify = /\bim\.notify\s*\(/.test(allCode);
  if (usesImNotify && !manifest?.permissions?.system?.includes('im-notification')) {
    issues.push({
      level: 'error',
      file: 'manifest.json',
      jsonPath: '/permissions/system',
      message: '应用代码调用了 im.notify()，但 manifest 没有声明 system:im-notification 权限。',
      hint: '在 manifest.permissions.system 加入 "im-notification"，并提供可见的通知目标、发送状态和失败原因入口。',
    });
  }
  if (usesImNotify) {
    issues.push(...validateImManagementUi(fileMap, manifest));
  }

  issues.push(...validateNativeGradeAppSpec(fileMap, {
    usesAi: usesAiComplete,
    workflowIds,
    usesDeepSearch,
    usesIm: usesImNotify,
  }));

  return issues;
}

function parseManifestForCapabilityCheck(content: string | undefined): ManifestCapabilityShape | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as ManifestCapabilityShape;
  } catch {
    return null;
  }
}

function firstSourceUsing(
  sourceFiles: Array<[string, string]>,
  pattern: RegExp,
): string | undefined {
  return sourceFiles.find(([, content]) => pattern.test(content))?.[0];
}

function extractCallStringLiterals(code: string, pattern: RegExp): string[] {
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(code)) !== null) {
    if (match[1]) values.add(match[1]);
  }
  return Array.from(values);
}

function validateAiManagementUi(
  fileMap: Map<string, string>,
  manifest: ManifestCapabilityShape | null,
): ValidationIssue[] {
  const settingsFiles = routeSourceFiles(fileMap, manifest)
    .filter((file) => /agent|ai|setting|config|settings|assistant/i.test(file.path));
  const candidateFiles = settingsFiles.length > 0 ? settingsFiles : routeSourceFiles(fileMap, manifest);
  const uiText = candidateFiles.map((file) => file.content).join('\n');
  const hasRoute = settingsFiles.length > 0 || /AI\s*设置|Agent\s*设置|智能体设置|提示词设置|模型设置/i.test(uiText);
  const hasSystemPrompt = /system\s*prompt|系统提示词|角色提示词|提示词/i.test(uiText);
  const hasOutputRequirements = /输出要求|输出格式|output\s*requirements|format\s*requirements/i.test(uiText);
  const hasTemperature = /\btemperature\b|温度/i.test(uiText);
  const hasMaxTokens = /\bmaxTokens\b|max\s*tokens|最大\s*token|最大输出/i.test(uiText);

  if (hasRoute && hasSystemPrompt && hasOutputRequirements && hasTemperature && hasMaxTokens) {
    return [];
  }

  return [{
    level: 'error',
    file: settingsFiles[0]?.path ?? 'manifest.json',
    jsonPath: '/',
    message: '应用使用了 ai.complete()，但没有可验收的 AI/Agent 设置入口。',
    hint: '新增可见路由或设置面板，让用户能管理 system prompt、输出要求、temperature、maxTokens，并在调用 ai.complete 时读取这些配置。',
  }];
}

function validateWorkflowManagementUi(
  fileMap: Map<string, string>,
  manifest: ManifestCapabilityShape | null,
  workflowIds: string[],
): ValidationIssue[] {
  const uiText = routeSourceFiles(fileMap, manifest)
    .map((file) => file.content)
    .join('\n');
  const hasWorkflowText = /工作流|自动化|Workflow|workflow/i.test(uiText);
  const hasStatusText = /运行状态|最近运行|失败原因|重试|status|retry|error/i.test(uiText);
  const mentionsWorkflowId = workflowIds.some((id) => uiText.includes(id));
  if (hasWorkflowText && hasStatusText && mentionsWorkflowId) {
    return [];
  }
  return [{
    level: 'error',
    file: 'manifest.json',
    jsonPath: '/routes',
    message: '应用使用了 workflow.run()，但没有可见的工作流管理/状态入口。',
    hint: `新增“工作流/自动化”页面或面板，展示 ${workflowIds.join(', ')} 的用途、输入、触发按钮、运行状态、失败原因和重试入口。`,
  }];
}

function validateDeepSearchManagementUi(
  fileMap: Map<string, string>,
  manifest: ManifestCapabilityShape | null,
): ValidationIssue[] {
  const uiText = routeSourceFiles(fileMap, manifest)
    .map((file) => file.content)
    .join('\n');
  const hasDeepSearchText = /DeepSearch|深度搜索|资料源|搜索范围/i.test(uiText);
  const hasStatusText = /登录|权限|运行中|结果证据|证据|失败|重试|status|retry|evidence/i.test(uiText);
  if (hasDeepSearchText && hasStatusText) {
    return [];
  }
  return [{
    level: 'error',
    file: 'manifest.json',
    jsonPath: '/routes',
    message: '应用调用了 deepsearch.*，但没有可见的 DeepSearch 配置/状态/结果入口。',
    hint: '新增 DeepSearch 配置或状态页，展示搜索范围、登录/权限状态、运行中状态、结果证据、失败原因和重试入口。',
  }];
}

function validateImManagementUi(
  fileMap: Map<string, string>,
  manifest: ManifestCapabilityShape | null,
): ValidationIssue[] {
  const uiText = routeSourceFiles(fileMap, manifest)
    .map((file) => file.content)
    .join('\n');
  const hasImText = /IM|微信|通知|notify|notification/i.test(uiText);
  const hasStatusText = /发送状态|失败原因|未接入|绑定|主 Agent|Main Agent|status|error/i.test(uiText);
  if (hasImText && hasStatusText) return [];
  return [{
    level: 'error',
    file: 'manifest.json',
    jsonPath: '/routes',
    message: '应用调用了 im.notify()，但没有可见的 IM 通知管理入口。',
    hint: '新增“通知/命令”页面或设置面板，展示通知目标、绑定要求、发送状态和失败原因，并说明用户回复进入主 Agent。',
  }];
}

function routeSourceFiles(
  fileMap: Map<string, string>,
  manifest: ManifestCapabilityShape | null,
): Array<{ path: string; content: string }> {
  const routePages = new Set(
    (manifest?.routes ?? [])
      .map((route) => route.page)
      .filter((page): page is string => typeof page === 'string' && page.endsWith('.tsx')),
  );
  const sourceFiles = Array.from(fileMap.entries())
    .filter(([path]) => path.startsWith('pages/') && path.endsWith('.tsx'))
    .map(([path, content]) => ({ path, content }));
  if (routePages.size === 0) return sourceFiles;
  const routed = sourceFiles.filter((file) => routePages.has(file.path));
  return routed.length > 0 ? routed : sourceFiles;
}
