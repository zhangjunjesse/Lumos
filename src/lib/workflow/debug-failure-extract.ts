/**
 * 把 stage-worker 的失败 step output 拆成用户能看懂的诊断:
 *   - primaryMessage: 真实错误(diagnostics.rawMessage),不再是兜底 "Task execution failed"
 *   - stderr / outputPreview / stack / cause: 命令/进程/堆栈细节
 *   - providerInfo: Provider + 模型信息,帮定位 Provider 配置问题
 *   - hint: 根据错误内容给出"下一步怎么办"建议
 */
import { formatWorkflowError } from './error-format';

export interface StepFailureDetail {
  stepId: string;
  errorName: string | null;
  errorCode: string | null;
  primaryMessage: string;
  stderr: string | null;
  stack: string | null;
  outputPreview: string | null;
  cause: string | null;
  providerInfo: string | null;
  summary: string | null;
  completedAt: string;
  durationMs: number;
  hint: string | null;
}

interface StepRow {
  stepId: string;
  output: unknown;
  error?: string;
  durationMs: number;
  completedAt: string;
}

function pick(o: Record<string, unknown>, key: string): unknown {
  return o[key];
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function extractProviderInfo(diag: Record<string, unknown>): string | null {
  const name = asString(pick(diag, 'providerName')) ?? asString(pick(diag, 'providerId'));
  const model = asString(pick(diag, 'resolvedModel')) ?? asString(pick(diag, 'requestedModel'));
  if (!name && !model) return null;
  if (name && model) return `${name} / ${model}`;
  return name || model;
}

// Heuristic → 根据错误内容给用户一个"接下来怎么办"的建议
export function suggestHint(params: {
  errorName: string | null;
  errorCode: string | null;
  primaryMessage: string;
  stderr: string | null;
  outputPreview: string | null;
}): string | null {
  const blob = [
    params.errorName,
    params.errorCode,
    params.primaryMessage,
    params.stderr,
    params.outputPreview,
  ].filter(Boolean).join(' \n ').toLowerCase();

  if (!blob) return null;

  if (/401|unauthorized|invalid api key|no auth|authentication failed/.test(blob)) {
    return 'Provider API Key 无效或过期,去 设置 → Provider 管理 重新配置 Key。';
  }
  if (/403|forbidden|permission denied|eacces/.test(blob)) {
    return '权限被拒:检查 API Key 的调用额度/权限,或文件系统 chmod。';
  }
  if (/429|rate limit|too many requests|quota/.test(blob)) {
    return '触发限流或额度不足,稍后重试或在 Provider 里切换到其他 Key/模型。';
  }
  if (/5\d\d|server error|service unavailable|bad gateway/.test(blob)) {
    return 'Provider 侧 5xx,多半是服务端问题,稍后重跑此步即可。';
  }
  if (/timeout|timed out|etimedout/.test(blob)) {
    return '请求超时,检查网络或在步骤 policy 里增大 timeoutMs。';
  }
  if (/econnrefused|enotfound|econnreset|network|fetch failed/.test(blob)) {
    return '网络连不上:检查 Provider Base URL 是否正确、代理/VPN 是否开启。';
  }
  if (/enoent|no such file|file not found/.test(blob)) {
    return '文件不存在:检查 prompt 里引用的路径/上游 step 输出是否真的生成。';
  }
  if (/sqlite|database/.test(blob)) {
    return '数据库操作失败:查看完整执行记录的日志排查 SQL/schema 问题。';
  }
  if (/json|parse|unexpected token|syntax error/.test(blob)) {
    return 'Agent 返回的内容不符合结构化 schema。检查 prompt 是否明确要求 JSON 格式,或把 outputMode 改为 text。';
  }
  if (/agent_reported_failure|任务未完成|blocked/.test(blob)) {
    return 'Agent 自己报告未完成任务,查看 summary 看它卡在哪步;可能需要细化 prompt 或放宽校验。';
  }
  if (/context|token|too long|max tokens/.test(blob)) {
    return '上下文超长,减小上游 step 输出或切换到大上下文模型。';
  }
  return null;
}

export function extractFailureDetail(step: StepRow): StepFailureDetail {
  const output = (step.output && typeof step.output === 'object')
    ? step.output as Record<string, unknown>
    : {};
  const err = (output['error'] && typeof output['error'] === 'object')
    ? output['error'] as Record<string, unknown>
    : {};
  const diag = (output['diagnostics'] && typeof output['diagnostics'] === 'object')
    ? output['diagnostics'] as Record<string, unknown>
    : {};

  const rawMessage = asString(pick(diag, 'rawMessage'));
  const sanitizedMessage = asString(pick(diag, 'sanitizedMessage'));
  const errMessage = asString(pick(err, 'message'));
  const fallback = asString(step.error ?? '');

  const primaryMessage = formatWorkflowError(
    rawMessage || errMessage || sanitizedMessage || fallback || '未知错误',
  );

  const errorName = asString(pick(diag, 'errorName'));
  const errorCode = asString(pick(err, 'code')) ?? asString(pick(diag, 'errorCode'));
  const stderr = asString(pick(diag, 'stderr'));
  const stack = asString(pick(diag, 'stack'));
  const outputPreview = asString(pick(diag, 'outputPreview'))
    ?? asString(pick(diag, 'structuredOutputPreview'));
  const cause = asString(pick(diag, 'cause'));
  const summary = asString(output['summary']);
  const providerInfo = extractProviderInfo(diag);

  const hint = suggestHint({ errorName, errorCode, primaryMessage, stderr, outputPreview });

  return {
    stepId: step.stepId,
    errorName,
    errorCode,
    primaryMessage,
    stderr,
    stack,
    outputPreview,
    cause,
    providerInfo,
    summary,
    completedAt: step.completedAt,
    durationMs: step.durationMs,
    hint,
  };
}
