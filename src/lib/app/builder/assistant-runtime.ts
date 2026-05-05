import {
  APP_BUILDER_SYSTEM_PROMPT_KEY,
  DEFAULT_APP_BUILDER_SYSTEM_PROMPT,
} from '@/lib/app/builder/assistant-config';
import {
  EXPECTED_TOOL_LOOP_RESPONSE_HINT,
  normalizeToolLoopResponse,
  toolLoopResponseCandidateSchema,
  type ToolLoopResponse,
} from '@/lib/app/builder/assistant-runtime-schema';
import {
  createSessionStore,
  type BuilderStory,
  type SessionStatus,
  type SessionStore,
} from '@/lib/app/builder/session';
import { getAppBuilderTemplate } from '@/lib/app/builder/templates';
import type { ValidationIssue } from '@/lib/app/manifest/types';
import { getAppPlatformService } from '@/lib/app/service';
import { compileApp, createModuleCache } from '@/lib/app/compile/compiler';
import { isAllowedAppPath, type RuntimeCompileResult } from '@/lib/app/compile/types';
import { getSetting } from '@/lib/db/sessions';
import { resolveAppBuilderProviderAndModel } from '@/lib/chat/app-builder-session';
import { validateAppCapabilityContracts } from '@/lib/app/builder/capability-contracts';
import {
  generateObjectWithFallback,
} from '@/lib/text-generator';

interface NormalizedFile {
  path: string;
  content: string;
}

export interface AppBuilderToolTraceEvent {
  tool: string;
  ok: boolean;
  summary: string;
  issues?: ValidationIssue[];
  files?: string[];
}

interface ToolLoopResult {
  assistantMessage: string;
  nextStatus?: 'gathering' | 'demo_review' | 'final_build' | 'iterating';
  files: NormalizedFile[];
  issues: ValidationIssue[];
  trace: AppBuilderToolTraceEvent[];
}

export interface AppBuilderAssistantResult {
  ok: boolean;
  message: unknown;
  savedFiles: string[];
  issues: ValidationIssue[];
  session: unknown;
  artifacts: unknown[];
  messages: unknown[];
}

export interface AppBuilderAssistantEventSink {
  status?: (message: string) => void;
  token?: (chunk: string) => void;
  trace?: (event: AppBuilderToolTraceEvent) => void;
}

export async function runAppBuilderAssistantTurn(input: {
  sessionId: string;
  userMessage: string;
  providerId?: string;
  model?: string;
  stream?: boolean;
  events?: AppBuilderAssistantEventSink;
}): Promise<AppBuilderAssistantResult> {
  const { db } = getAppPlatformService();
  const store = createSessionStore(db);
  const session = store.getSession(input.sessionId);
  if (!session) {
    throw new AppBuilderAssistantError('Session not found', 404);
  }

  store.appendMessage({
    sessionId: input.sessionId,
    role: 'user',
    content: input.userMessage,
  });

  const providerModel = resolveAppBuilderProviderAndModel({
    providerId: input.providerId,
    model: input.model,
  });
  if ('error' in providerModel) {
    store.appendMessage({
      sessionId: input.sessionId,
      role: 'assistant',
      content: providerModel.error,
    });
    throw new AppBuilderAssistantError(providerModel.error, 400);
  }

  const currentArtifacts = store.getCurrentArtifacts(input.sessionId);
  const currentStories = store.listStories(input.sessionId);
  const currentNonGoals = extractNonGoalsFromSummary(session.needsSummary);
  const history = store.listMessages(input.sessionId).slice(-8).map((message) => ({
    role: message.role,
    content: contentForPrompt(message.content),
  }));
  const baseSystem = buildBaseSystemPrompt();
  const prompt = buildUserPrompt({
    session,
    history,
    currentFiles: currentArtifacts.map((artifact) => ({
      path: artifact.filePath,
      content: artifact.content,
    })),
    stories: currentStories,
    nonGoals: currentNonGoals,
    latestUserMessage: input.userMessage,
  });

  const toolLoop = await runToolLoop({
    providerId: providerModel.providerId,
    model: providerModel.model,
    system: baseSystem,
    prompt,
    store,
    sessionId: input.sessionId,
    initialStories: currentStories,
    initialFiles: currentArtifacts.map((artifact) => ({
      path: artifact.filePath,
      content: artifact.content,
    })),
    events: input.events,
  }).catch((err: Error) => {
    input.events?.status?.('生成失败');
    return {
      assistantMessage: `生成失败：${err.message}。请用更清晰的话再描述一下你的需求，我重新尝试。`,
      nextStatus: undefined,
      files: [],
      issues: [{
        level: 'error',
        file: 'app-builder',
        jsonPath: '/',
        message: err.message,
      }],
      trace: [],
    } satisfies ToolLoopResult;
  });

  const savedFiles: string[] = [];
  if (toolLoop.files.length > 0 && toolLoop.issues.length === 0) {
    input.events?.status?.('正在更新应用…');
    for (const file of toolLoop.files) {
      store.saveArtifact({
        sessionId: input.sessionId,
        filePath: file.path,
        content: file.content,
      });
      savedFiles.push(file.path);
    }
    store.updateStatus(
      input.sessionId,
      toolLoop.nextStatus ?? defaultNextStatus(session),
    );
    const nextSummary = buildNeedsSummary(session.needsSummary, toolLoop.files);
    if (nextSummary) {
      store.setNeedsSummary(input.sessionId, nextSummary);
    }
    store.appendMessage({
      sessionId: input.sessionId,
      role: 'tool',
      toolName: 'app_builder_ai',
      content: {
        summary: 'AI 已更新应用草稿文件',
        providerId: providerModel.providerId,
        model: providerModel.model,
        files: savedFiles,
        trace: toolLoop.trace,
      },
    });
  } else if (toolLoop.nextStatus) {
    store.updateStatus(input.sessionId, toolLoop.nextStatus);
  }

  const assistantText =
    toolLoop.issues.length > 0
      ? `${toolLoop.assistantMessage}\n\n我已经运行了工具自检，但文件仍有问题，暂未写入无效文件：\n${formatIssues(toolLoop.issues)}`
      : toolLoop.assistantMessage;

  const assistant = store.appendMessage({
    sessionId: input.sessionId,
    role: 'assistant',
    content: assistantText,
  });

  return {
    ok: toolLoop.issues.length === 0,
    message: assistant,
    savedFiles,
    issues: toolLoop.issues,
    session: store.getSession(input.sessionId),
    artifacts: store.getCurrentArtifacts(input.sessionId),
    messages: store.listMessages(input.sessionId),
  };
}

export class AppBuilderAssistantError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function buildBaseSystemPrompt(): string {
  const configuredPrompt = getSetting(APP_BUILDER_SYSTEM_PROMPT_KEY) || '';
  return configuredPrompt || DEFAULT_APP_BUILDER_SYSTEM_PROMPT;
}

function buildUserPrompt(input: {
  session: {
    id: string;
    appName?: string;
    appDescription?: string;
    status: string;
    templateId?: string;
  };
  history: Array<{ role: string; content: string }>;
  currentFiles: Array<{ path: string; content: string }>;
  stories: BuilderStory[];
  nonGoals: string[];
  latestUserMessage: string;
}): string {
  const filesBlock = input.currentFiles.length > 0
    ? input.currentFiles
        .map((f) => `### ${f.path}\n\`\`\`${codeFenceLang(f.path)}\n${f.content.trim()}\n\`\`\``)
        .join('\n\n')
    : '(应用还没有任何文件。下一步用 write_files 从 manifest.json + data-schema.json + pages/index.tsx 开始建立。)';
  const history =
    input.history.length > 0
      ? input.history.map((message) => `${message.role}: ${message.content}`).join('\n')
      : '(无)';
  const template = getAppBuilderTemplate(input.session.templateId);
  const stories = input.stories.length > 0
    ? input.stories.map(formatStoryForPrompt).join('\n')
    : '(还没有 Story。请先按应用开发 SOP 梳理 Story，并写入待确认 Story。)';
  const nonGoals = input.nonGoals.length > 0
    ? input.nonGoals.map((item) => `- ${item}`).join('\n')
    : '(暂无)';

  const phaseHint = describePhase(input.session.status);

  return `当前应用开发会话：
- sessionId: ${input.session.id}
- appName: ${input.session.appName || '未命名应用'}
- appDescription: ${input.session.appDescription || '未填写'}
- status: ${input.session.status}
${template ? `- template: ${template.name}\n- templateGuide: ${template.prompt}` : '- template: 空白应用'}

当前阶段（必须严格遵守 SOP 6a/6b/6c）：
${phaseHint}

不要做的（应用范围红线，不能违反）：
${nonGoals}

最近对话：
${history}

当前 Story：
${stories}

当前应用文件（这是数据库真相，是改动的起点；用 write_file 修改时基于现状增量改）：
${filesBlock}

用户最新要求：
${input.latestUserMessage}

请根据当前阶段和最新要求继续。如果用户提到「不要 / 别做 / 不需要 X」，调用 set_non_goals 工具更新「不做的」清单。`;
}

function codeFenceLang(path: string): string {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.ts')) return 'ts';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  return '';
}

function describePhase(status: string): string {
  if (status === 'gathering') {
    return [
      '- 现在还在「需求收集」阶段。请按 SOP 1-5 步访谈、梳理 Story、推导数据/页面。还不要写应用文件。',
      '- ⚠ 用户每描述一段新需求，本轮就要用 upsert_story 把每条新 Story 写入（id 留空=新增），不要只在 assistantMessage 里口头列出来。',
      '- ⚠ 用户说"确认/可以"时，对每条相关 Story 调用 upsert_story（id 必传，status="confirmed"）持久化，然后 finish 时 nextStatus 可以保持 gathering 等用户进一步指令，或在用户明确说"开始做"时切到 demo_review。',
    ].join('\n');
  }
  if (status === 'demo_review') {
    return [
      '- 现在在「Demo 阶段」。按 SOP 6a 用 write_files 生成最小核心 1-2 页 + 最小 manifest + data-schema，不写校验/空态/设置/workflow。',
      '- 例外：如果核心流程依赖 AI / Agent / Workflow / DeepSearch，Demo 也必须包含轻量设置/状态入口和 manifest 权限，不能隐藏这些能力。',
      '- 列表页直接用 const 数组放 5-10 条 mock 数据让预览有内容。',
      '- 编译失败时下一轮 prompt 会带详细错误（含行号），**必须按错误精确修**，不要把同样错误的代码再发一遍。',
      '- finish 时 nextStatus="demo_review"。assistantMessage 必须提示用户去预览 tab 走一遍并点顶部「确认 Demo」。',
      '- 用户在这阶段说「不对/再调整」时，用 write_file 改对应文件，不要切到 final。',
    ].join('\n');
  }
  if (status === 'final_build') {
    return [
      '- 现在在「Final 阶段」。按 SOP 6c 在已确认的 demo 文件基础上**增量补完**：write_file 加新 page tsx + 在 manifest 加 route，给表单加 Label + 本地校验/错误反馈，给列表加 Skeleton/空态/Alert 错误态。',
      '- 如果应用依赖 AI / Agent / Workflow / DeepSearch，必须补齐可见设置/管理页、权限声明、loading/error/retry 和运行状态；不能只在按钮里调用平台 API。',
      '- 不要重写 demo 已确认的核心页面骨架。',
      '- finish 时 nextStatus="iterating"。',
    ].join('\n');
  }
  if (status === 'iterating') {
    return '- 应用已经过完整生成，现在做迭代修改。按用户要求增量调整页面/数据/工作流。';
  }
  if (status === 'installed') {
    return '- 应用已安装。如有修改需求，按迭代方式增量调整即可。';
  }
  return '- 阶段未知，按 SOP 流程从需求访谈开始。';
}

function defaultNextStatus(session: { appId?: string; status: SessionStatus }): SessionStatus {
  if (session.appId) return 'iterating';
  if (session.status === 'final_build' || session.status === 'iterating') return session.status;
  if (session.status === 'demo_review') return 'demo_review';
  return 'demo_review';
}

function extractNonGoalsFromSummary(summary: Record<string, unknown> | undefined): string[] {
  const raw = summary?.nonGoals;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function contentForPrompt(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function formatStoryForPrompt(story: BuilderStory): string {
  const criteria = story.acceptanceCriteria.length > 0
    ? story.acceptanceCriteria.map((item) => `    - ${item}`).join('\n')
    : '    - (未填写)';
  const pages = story.relatedPages.length > 0 ? story.relatedPages.join(', ') : '未关联';
  const collections = story.relatedCollections.length > 0
    ? story.relatedCollections.join(', ')
    : '未关联';
  return [
    `- id: ${story.id}`,
    `  title: ${story.title}`,
    `  status: ${story.status}`,
    `  priority: P${story.priority}`,
    `  story: ${story.storyText}`,
    story.actor ? `  actor: ${story.actor}` : '',
    story.goal ? `  goal: ${story.goal}` : '',
    story.benefit ? `  benefit: ${story.benefit}` : '',
    `  acceptanceCriteria:\n${criteria}`,
    `  relatedPages: ${pages}`,
    `  relatedCollections: ${collections}`,
  ].filter(Boolean).join('\n');
}

async function runToolLoop(input: {
  providerId: string;
  model: string;
  system: string;
  prompt: string;
  store: SessionStore;
  sessionId: string;
  initialStories: BuilderStory[];
  initialFiles: NormalizedFile[];
  events?: AppBuilderAssistantEventSink;
}): Promise<ToolLoopResult> {
  const fileMap = new Map<string, string>();
  const originalFiles = new Map<string, string>();
  const storyIds = new Set(input.initialStories.map((story) => story.id));
  for (const file of input.initialFiles) {
    fileMap.set(file.path, file.content);
    originalFiles.set(file.path, file.content);
  }

  const trace: AppBuilderToolTraceEvent[] = [];
  const recordTrace = (event: AppBuilderToolTraceEvent) => {
    trace.push(event);
    input.events?.trace?.(event);
  };
  let assistantMessage = '我已根据你的要求更新应用草稿。';
  let nextStatus: ToolLoopResult['nextStatus'];
  let lastIssues: ValidationIssue[] = [];
  let observations = '';
  let lastCompileResult: RuntimeCompileResult | undefined;
  const moduleCache = createModuleCache();

  for (let turn = 1; turn <= 2; turn += 1) {
    input.events?.status?.(turn === 1 ? '思考中…' : `修复编译错误（${turn}/2）`);
    const turnIssues: ValidationIssue[] = [];
    lastCompileResult = undefined;
    let response: ToolLoopResponse;

    try {
      const candidate = await generateObjectWithFallback({
        providerId: input.providerId,
        model: input.model,
        system: buildToolLoopSystemPrompt(input.system),
        prompt: buildToolLoopPrompt({
          basePrompt: input.prompt,
          files: mapToFiles(fileMap),
          observations,
          turn,
        }),
        schema: toolLoopResponseCandidateSchema,
        maxTokens: 4096,
      });
      response = normalizeToolLoopResponse(candidate);
    } catch (error) {
      const issue = toolLoopOutputIssue(error);
      turnIssues.push(issue);
      lastIssues = turnIssues;
      recordTrace({
        tool: 'structured_output',
        ok: false,
        summary: '模型输出不符合应用开发工具循环 JSON 格式',
        issues: [issue],
      });
      observations = [
        observations,
        `第 ${turn} 轮工具结果：`,
        trace.slice(-6).map(formatTraceForPrompt).join('\n'),
        EXPECTED_TOOL_LOOP_RESPONSE_HINT,
      ].filter(Boolean).join('\n\n');
      continue;
    }

    let wroteFile = false;
    for (const action of response.actions) {
      if (action.type === 'upsert_story') {
        let story: BuilderStory | null;
        if (action.id && storyIds.has(action.id)) {
          story = input.store.updateStory(input.sessionId, action.id, {
            title: action.title,
            storyText: action.storyText,
            actor: action.actor,
            goal: action.goal,
            benefit: action.benefit,
            status: action.status,
            priority: action.priority,
            acceptanceCriteria: action.acceptanceCriteria,
            relatedPages: action.relatedPages,
            relatedCollections: action.relatedCollections,
          });
        } else if (action.title && action.storyText) {
          story = input.store.createStory(input.sessionId, {
            title: action.title,
            storyText: action.storyText,
            actor: action.actor,
            goal: action.goal,
            benefit: action.benefit,
            status: action.status ?? 'pending_confirmation',
            priority: action.priority,
            acceptanceCriteria: action.acceptanceCriteria,
            relatedPages: action.relatedPages,
            relatedCollections: action.relatedCollections,
          });
        } else {
          const issue: ValidationIssue = {
            level: 'error',
            file: 'app-builder',
            jsonPath: '/',
            message: action.id
              ? `Story ${action.id} 不存在，且本次 upsert_story 没有提供 title/storyText，无法创建或更新。`
              : '新增 Story 必须提供 title 和 storyText。',
          };
          turnIssues.push(issue);
          recordTrace({
            tool: 'upsert_story',
            ok: false,
            summary: 'Story 新增/更新失败：缺少必要字段',
            issues: [issue],
          });
          continue;
        }
        if (story) {
          storyIds.add(story.id);
          recordTrace({
            tool: 'upsert_story',
            ok: true,
            summary: `${action.id ? '已更新' : '已新增'} Story：${story.title}`,
          });
        }
      }

      if (action.type === 'write_file') {
        const issues = stageWrite(file => file.path === action.path, fileMap, [{ path: action.path, content: action.content }]);
        if (issues.length > 0) {
          turnIssues.push(...issues);
          recordTrace({
            tool: 'write_file',
            ok: false,
            summary: `写入 ${action.path} 失败：路径不在允许范围`,
            issues,
          });
          continue;
        }
        wroteFile = true;
        recordTrace({
          tool: 'write_file',
          ok: true,
          summary: `已暂存 ${action.path}（${action.content.length} 字符）`,
          files: [action.path],
        });
      }

      if (action.type === 'write_files') {
        const issues = stageWrite(() => true, fileMap, action.files);
        if (issues.length > 0) {
          turnIssues.push(...issues);
          recordTrace({
            tool: 'write_files',
            ok: false,
            summary: `批量写入失败：${issues.length} 个路径不合法`,
            issues,
          });
          continue;
        }
        wroteFile = true;
        recordTrace({
          tool: 'write_files',
          ok: true,
          summary: `已暂存 ${action.files.length} 个文件${action.change_summary ? '：' + action.change_summary : ''}`,
          files: action.files.map((f) => f.path),
        });
      }

      if (action.type === 'delete_file') {
        if (!isAllowedAppPath(action.path)) {
          turnIssues.push({
            level: 'error',
            file: action.path,
            jsonPath: '/',
            message: `路径 ${action.path} 不在允许范围内，无法删除。`,
          });
          recordTrace({
            tool: 'delete_file',
            ok: false,
            summary: `删除 ${action.path} 失败：路径不在允许范围`,
          });
          continue;
        }
        fileMap.delete(action.path);
        wroteFile = true;
        recordTrace({
          tool: 'delete_file',
          ok: true,
          summary: `已删除 ${action.path}`,
          files: [action.path],
        });
      }

      if (action.type === 'set_non_goals') {
        const sessionNow = input.store.getSession(input.sessionId);
        const merged = {
          ...(sessionNow?.needsSummary ?? {}),
          nonGoals: action.items,
        };
        input.store.setNeedsSummary(input.sessionId, merged);
        recordTrace({
          tool: 'set_non_goals',
          ok: true,
          summary:
            action.items.length > 0
              ? `已更新「不做的」清单：${action.items.join('、')}`
              : '已清空「不做的」清单',
        });
      }

      if (action.type === 'finish') {
        assistantMessage = action.assistantMessage;
        nextStatus = action.nextStatus;
      }
    }

    // After all actions in this turn, if any TSX/TS files changed, run esbuild
    // to catch syntax errors / disallowed imports. Compile failure → reject and
    // feed errors back so AI fixes next turn.
    if (wroteFile && turnIssues.length === 0) {
      const compileResult = await compileApp(
        Array.from(fileMap.entries()).map(([path, content]) => ({ path, content })),
        { appId: input.sessionId, cache: moduleCache },
      );
      lastCompileResult = compileResult;
      if (!compileResult.ok) {
        const compileIssues: ValidationIssue[] = compileResult.errors.map((err) => ({
          level: 'error',
          file: err.file ?? 'unknown',
          jsonPath: '/',
          message: err.line ? `第 ${err.line} 行：${err.message}` : err.message,
          ...(err.hint ? { hint: err.hint } : {}),
        }));
        turnIssues.push(...compileIssues);
        recordTrace({
          tool: 'compile',
          ok: false,
          summary: `编译失败：${compileResult.errors.length} 个错误`,
          issues: compileIssues,
        });
      } else {
        recordTrace({
          tool: 'compile',
          ok: true,
          summary: `编译通过：${compileResult.modules.length} 个模块（${compileResult.fromCache.length} 命中缓存）`,
        });
      }
    }

    if (wroteFile && turnIssues.length === 0) {
      const capabilityIssues = validateAppCapabilityContracts(fileMap);
      if (capabilityIssues.length > 0) {
        turnIssues.push(...capabilityIssues);
        recordTrace({
          tool: 'capability_contract',
          ok: false,
          summary: `能力契约检查失败：${capabilityIssues.length} 个问题`,
          issues: capabilityIssues,
        });
      }
    }

    const hasErrors = turnIssues.some((issue) => issue.level === 'error');
    if (!hasErrors && (wroteFile || response.actions.some((action) => action.type === 'finish'))) {
      return {
        assistantMessage,
        nextStatus,
        files: changedFiles(fileMap, originalFiles),
        issues: [],
        trace,
      };
    }

    lastIssues = turnIssues;
    const compileFeedback = lastCompileResult && !lastCompileResult.ok
      ? `\n\n# 编译错误（必须修复后再提交）\n${lastCompileResult.errors.map((e) => `- ${e.file ?? '?'}${e.line ? `:${e.line}` : ''} — ${e.message}${e.hint ? ` (${e.hint})` : ''}`).join('\n')}`
      : '';
    observations = [
      observations,
      `第 ${turn} 轮工具结果：`,
      trace.slice(-6).map(formatTraceForPrompt).join('\n'),
      compileFeedback,
    ].filter(Boolean).join('\n\n');
  }

  const lastErrorMsgs = lastCompileResult && !lastCompileResult.ok
    ? lastCompileResult.errors.slice(0, 3).map((e) => `- ${e.file ?? '?'}: ${e.message}`).join('\n')
    : '';
  const forcedMessage = lastErrorMsgs
    ? `编译失败 2 轮，未生成有效应用：\n${lastErrorMsgs}\n\n请用更清晰的话再描述一下你的需求，我重新尝试。`
    : '生成失败，请再描述一下你的需求重试。';

  return {
    assistantMessage: forcedMessage,
    nextStatus,
    files: [],
    issues: lastIssues.length > 0
      ? lastIssues
      : [{
          level: 'error',
          file: 'app',
          jsonPath: '/',
          message: '编译 2 轮后仍失败，请再描述一下需求重试。',
        }],
    trace,
  };
}

function toolLoopOutputIssue(error: unknown): ValidationIssue {
  const message = error instanceof Error ? error.message : String(error);
  return {
    level: 'error',
    file: 'app-builder',
    jsonPath: '/',
    message,
    hint: EXPECTED_TOOL_LOOP_RESPONSE_HINT,
  };
}

function buildToolLoopSystemPrompt(baseSystem: string): string {
  return `${baseSystem}

# 工具循环执行协议
你现在不是直接交付说明文字，而是在服务端工具循环中工作。每一轮只能返回 JSON actions：
顶层必须是一个 JSON object，形如 {"actions":[{"type":"finish","assistantMessage":"..."}]}，不能只返回数组或普通说明文字。
- upsert_story：新增或更新一条用户故事。新 Story 默认 pending_confirmation，用户确认后才能改 confirmed。
- set_non_goals：用 items: string[] 全量替换「不做的」清单。要保留旧项就写进 items。
- write_file({ path, content })：写或覆盖单个文件（manifest.json / data-schema.json / workflows/*.json / pages/*.tsx / components/*.tsx / lib/*.ts / styles/*.css）。
- write_files({ files: [...], change_summary? })：原子式一次写多个文件。新建应用首轮通常用这个一次写 manifest + data-schema + 几个 pages。
- delete_file({ path })：删除文件。
- finish：结束本轮，用 assistantMessage 告诉用户下一步。

每次写完文件，服务端用 esbuild 编译。编译失败下一轮 prompt 会带详细错误（含行号），必须基于错误精确修复，不要把同样错误的代码再发一遍。

强制规则（违反 = bug）：
- 当前应用文件在 prompt 里以代码块形式给出，是数据库真相。改动时基于现状增量改 write_file，不要重写无关的文件。
- 写代码必须用 @lumos/ui 预制 shadcn 组件，禁止自己造 Button/Card/Table；禁止 inline style；颜色只用 token class（bg-background/bg-card/bg-primary/text-foreground/text-muted-foreground/border-border），禁 hex 和 bg-white/text-black。
- @lumos/ui 当前可 import：Alert/AlertDialog/Badge/Button/Card/Checkbox/Collapsible/Command/Dialog/DropdownMenu/HoverCard/Input/Label/Popover/ScrollArea/Select/Separator/Sheet/Skeleton/Spinner/Switch/Tabs/Textarea/Tooltip/cn。不要 import 未导出的 Table/EmptyState/Form/Avatar/Progress/Chart。
- 列表数据必须处理 loading/empty/error 三态：loading 用 Skeleton/Spinner，error 用 Alert，empty 用 Card/Badge 等可用组件；表格可用原生 table + token class，不允许裸 data.map。
- 长列表（>20 行）必须有 search/filter。
- 表单必须有 Label + 本地校验 + submit loading + 错误提示；当前不要默认引入 react-hook-form 或 zod。
- 危险操作必须 notify.confirm。
- 一个 view 只能一个 primary button。
- 所有 icon-only button 必须有 aria-label。
- 禁止 import 白名单外的 npm 包（react/react-dom/@lumos/app/@lumos/ui/lucide-react/clsx/tailwind-merge/class-variance-authority），相对路径必须 ./ 或 ../ 开头。当前不要 import recharts/framer-motion/date-fns/react-hook-form/zod/zustand/@dnd-kit/core/cmdk。
- 使用 ai.complete 必须在 manifest.permissions.ai 声明 { "complete": true }；当前不要默认使用 ai.stream / ai.structured。
- 使用 AI / Agent 必须有可见设置入口，至少能管理 system prompt、输出要求、temperature、maxTokens，并在调用 ai.complete 时读取这些配置。
- 使用 workflow.run 必须在 manifest.permissions.workflow.run 声明 id，同时写入对应 workflows/<id>.json，并生成可见的工作流管理/状态入口；当前 workflow bridge 未完整接入时，要在 UI 里明确显示“运行能力未就绪 / 等待平台接入”，不要假装已经能完整执行。
- 使用 deepsearch.* 必须声明 permissions.deepsearch 对应权限，并生成 DeepSearch 配置/状态/结果/错误/重试入口；不要用 AI 直接写报告冒充 DeepSearch 搜索。
- **assistantMessage 里提到的每条 Story 都必须在同一轮 actions 里有对应的 upsert_story。** 说"我新增了 N 条"但调用次数对不上 = 欺骗用户。
- **永远不要在 assistantMessage 里报 Story 数量**（例："现在一共 6 条"），除非数字 = prompt 当前 Story 列表长度 + 本轮 upsert_story 实际调用次数。
- 用户描述新需求 → 第一动作是 upsert_story（每条一次，id 留空=新增）→ 如果在 demo/final 阶段则同轮 write_files → finish。
- 用户说「确认/可以/就这样」→ 对相关 Story 调 upsert_story（id 必传，status='confirmed'）→ finish。
- 用户说「不要/别做/不需要 X」→ 当轮调 set_non_goals 加 X；不要只 finish 说"已记下"。
- 需求不清楚或还没有 confirmed Story 时，**只能** upsert_story + finish，不要写文件。
- 只有 confirmed / in_progress Story 才能进入应用文件。
- 不要把 nonGoals 里的功能写进文件 / 在回复里建议"是否需要"。
- 不要输出 markdown，不要解释工具协议，只返回包含 actions 数组的 JSON 对象。`;
}

function buildToolLoopPrompt(input: {
  basePrompt: string;
  files: NormalizedFile[];
  observations: string;
  turn: number;
}): string {
  return `${input.basePrompt}

## 工具循环状态
当前第 ${input.turn} 轮 / 共 2 轮。

${input.observations ? `## 上轮工具观察\n${input.observations}` : ''}

请返回下一组 actions。`;
}

function stageWrite(
  _filter: (file: { path: string }) => boolean,
  fileMap: Map<string, string>,
  files: Array<{ path: string; content: string }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const file of files) {
    if (!isAllowedAppPath(file.path)) {
      issues.push({
        level: 'error',
        file: file.path,
        jsonPath: '/',
        message: `路径 ${file.path} 不在允许范围内。允许：manifest.json / data-schema.json / workflows/*.json / pages/*.tsx / components/*.tsx / lib/*.ts / styles/*.css。`,
      });
    }
  }
  if (issues.length > 0) {
    return issues;
  }
  for (const file of files) {
    fileMap.set(file.path, file.content);
  }
  return issues;
}

function mapToFiles(fileMap: Map<string, string>): NormalizedFile[] {
  return Array.from(fileMap.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path, content }));
}

function changedFiles(
  fileMap: Map<string, string>,
  originalFiles: Map<string, string>,
): NormalizedFile[] {
  return mapToFiles(fileMap).filter((file) => originalFiles.get(file.path) !== file.content);
}

function formatTraceForPrompt(event: AppBuilderToolTraceEvent): string {
  const files = event.files?.length ? ` files=${event.files.join(',')}` : '';
  const issueText = event.issues?.length ? ` issues=${formatIssues(event.issues)}` : '';
  return `- ${event.tool}: ${event.ok ? 'ok' : 'failed'} ${event.summary}${files}${issueText}`;
}

function buildNeedsSummary(
  current: Record<string, unknown> | undefined,
  files: Array<{ path: string; content: string }>,
): Record<string, unknown> | null {
  const appFile = files.find((file) => file.path === 'app.json');
  if (!appFile) return current ?? null;
  try {
    const manifest = JSON.parse(appFile.content) as { name?: unknown; description?: unknown };
    return {
      ...(current ?? {}),
      appName: typeof manifest.name === 'string' ? manifest.name : current?.appName,
      appDescription:
        typeof manifest.description === 'string'
          ? manifest.description
          : current?.appDescription,
      updatedBy: 'app-builder-ai',
    };
  } catch {
    return current ?? null;
  }
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .slice(0, 8)
    .map((issue) => `- ${issue.file} ${issue.jsonPath}: ${issue.message}`)
    .join('\n');
}
