export interface MainAgentTaskDispatchPlan {
  taskSummary: string;
  requirements: string[];
}

const STATUS_OR_QUERY_PATTERNS = [
  /取消.*任务/,
  /任务.*(进度|状态|情况|详情|结果|汇报)/,
  /查看.*任务/,
  /有哪些.*任务/,
  /list tasks?/,
  /task status/,
  /task progress/,
  /cancel (the )?task/,
  /what('?s| is) the task/,
];

const DIRECT_RESPONSE_PATTERNS = [
  /^如何/,
  /^怎么/,
  /^为什么/,
  /^解释/,
  /^什么是/,
  /^what is\b/,
  /^how to\b/,
  /^why\b/,
  /^explain\b/,
];

const TASK_VERB_PATTERNS = [
  /实现/,
  /开发/,
  /搭建/,
  /重构/,
  /修复/,
  /改造/,
  /接入/,
  /整理/,
  /调研/,
  /研究/,
  /分析/,
  /规划/,
  /设计/,
  /搜索/,
  /搜一下/,
  /搜一搜/,
  /查一下/,
  /查询/,
  /检索/,
  /写一个/,
  /写个/,
  /做一个/,
  /做个/,
  /跑一遍/,
  /对比/,
  /比较/,
  /导出/,
  /pdf/i,
  /浏览器/,
  /网页/,
  /页面/,
  /网站/,
  /截图/,
  /workflow/,
  /implement/,
  /develop/,
  /build/,
  /refactor/,
  /fix\b/,
  /research/,
  /investigate/,
  /analy[sz]e/,
  /compare/,
  /search/,
  /export/,
  /\bpdf\b/i,
  /browser/,
  /screenshot/,
  /multi[- ]step/,
];

const IMPLEMENTATION_PATTERNS = [
  /实现/,
  /开发/,
  /搭建/,
  /重构/,
  /修复/,
  /改造/,
  /接入/,
  /\bimplement\b/,
  /\bdevelop\b/,
  /\bbuild\b/,
  /\brefactor\b/,
  /\bfix\b/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripLeadingBullet(value: string): string {
  return value
    .replace(/^\s*[-*•]+\s*/, '')
    .replace(/^\s*\d+[.)、]\s*/, '')
    .replace(/^\s*[（(]?\d+[）)]\s*/, '')
    .trim();
}

function stripPolitePrefix(value: string): string {
  return value
    .replace(/^(请你|请帮我|请帮忙|麻烦你|麻烦帮我|帮我|帮忙|我要你|我想让你|我想要你|我需要你|想让你|请)\s*/u, '')
    .replace(/^(能不能|可以|麻烦)\s*/u, '')
    .trim();
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[。！？!?；;，,：:\s]+$/u, '').trim();
}

function sanitizeClause(value: string): string {
  return stripTrailingPunctuation(
    normalizeWhitespace(
      stripPolitePrefix(
        stripLeadingBullet(value),
      ),
    ),
  );
}

function splitClauses(userInput: string): string[] {
  const normalizedInput = userInput
    .replace(/[。！？!?]/gu, '\n')
    .replace(/[；;]/gu, '\n');

  const lines = normalizedInput
    .split('\n')
    .flatMap((line) => line.split(/[，,]/u))
    .map((line) => sanitizeClause(line))
    .filter(Boolean);

  if (lines.length > 1) {
    return lines;
  }

  return normalizedInput
    .split(/[\n]/u)
    .flatMap((part) => part.split(/[，,]/u))
    .map((part) => sanitizeClause(part))
    .filter(Boolean);
}

function buildTaskSummary(userInput: string, clauses: string[]): string {
  const summaryCandidate = clauses.find((clause) => !/^要求[:：]?$/u.test(clause))
    || sanitizeClause(userInput);
  const summary = normalizeWhitespace(summaryCandidate).slice(0, 120).trim();
  return summary || '处理当前用户请求';
}

function buildTaskRequirements(userInput: string, clauses: string[], summary: string): string[] {
  const requirements = clauses
    .filter((clause) => clause !== summary)
    .map((clause) => clause.replace(/^(要求|重点|需要|请|并且|并|另外|同时)\s*/u, '').trim())
    .filter(Boolean);

  if (requirements.length > 0) {
    return Array.from(new Set(requirements)).slice(0, 8);
  }

  const normalized = userInput.trim();
  if (!normalized || normalized === summary) {
    return [];
  }

  return [normalized.slice(0, 180)];
}

function countTaskSignals(text: string): number {
  return TASK_VERB_PATTERNS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function buildMainAgentTaskDispatchHint(userInput: string): string | undefined {
  const normalized = userInput.trim().toLowerCase();
  if (!normalized || matchesAny(normalized, STATUS_OR_QUERY_PATTERNS)) {
    return undefined;
  }

  const taskSignalCount = countTaskSignals(normalized);
  const lineCount = normalized.split('\n').filter((line) => line.trim()).length;
  const longRequest = normalized.length >= 48;
  if (taskSignalCount === 0 && !longRequest && lineCount < 2) {
    return undefined;
  }

  return `This current Main Agent turn has been pre-classified by Lumos as a task-dispatch candidate.
If the request is an implementation, research, multi-step workflow, or anything that should not be completed inline, you must call task-management.createTask in this turn before claiming execution has started.
After createTask succeeds, briefly confirm the handoff and continue the conversation naturally.`;
}

export function planMainAgentTaskDispatch(params: {
  sessionId: string;
  userInput: string;
  hasFiles?: boolean;
}): MainAgentTaskDispatchPlan | null {
  const normalized = params.userInput.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (matchesAny(normalized, STATUS_OR_QUERY_PATTERNS)) {
    return null;
  }

  const taskSignalCount = countTaskSignals(normalized);
  const directResponseOnly = matchesAny(normalized, DIRECT_RESPONSE_PATTERNS) && taskSignalCount === 0;
  if (directResponseOnly) {
    return null;
  }

  const clauses = splitClauses(params.userInput);
  const taskSummary = buildTaskSummary(params.userInput, clauses);
  const requirements = buildTaskRequirements(params.userInput, clauses, taskSummary);

  const longRequest = normalized.length >= 48 || clauses.length >= 2;
  const implementationLike = matchesAny(normalized, IMPLEMENTATION_PATTERNS);
  const taskLikeWithFiles = params.hasFiles === true && taskSignalCount > 0;
  const dispatchRequired = implementationLike
    || taskLikeWithFiles
    || (taskSignalCount > 0 && (longRequest || requirements.length > 0));

  if (!dispatchRequired) {
    return null;
  }

  return {
    taskSummary,
    requirements,
  };
}
