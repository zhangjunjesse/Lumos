import type {
  ProviderHealthClassification,
  RawProbeResult,
} from './provider-health-types';

function pushDiagnosticText(parts: string[], value: unknown, depth = 0, seen = new Set<unknown>()): void {
  if (value === undefined || value === null || depth > 4) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) parts.push(trimmed);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    parts.push(String(value));
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of [
    'name',
    'code',
    'type',
    'status',
    'statusCode',
    'message',
    'error',
    'errors',
    'body',
    'response',
    'data',
    'cause',
    'request_id',
    'requestId',
  ]) {
    if (key in record) {
      pushDiagnosticText(parts, record[key], depth + 1, seen);
    }
  }
}

export function stringifyProviderProbeDiagnostic(raw: RawProbeResult): string {
  const parts: string[] = [];
  pushDiagnosticText(parts, raw.bodyJson);
  pushDiagnosticText(parts, raw.bodyText);
  pushDiagnosticText(parts, raw.error);
  if (parts.length === 0 && raw.httpStatus) parts.push(`HTTP ${raw.httpStatus}`);
  return parts.join('\n');
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof record.name === 'string' ? record.name : '';
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : '';
  return (
    name === 'AbortError'
    || code === 'ABORT_ERR'
    || /aborted|aborterror|timeout|timed out/i.test(message)
  );
}

function hasQuotaText(text: string): boolean {
  return (
    /tokenstatusexhausted/i.test(text)
    || /insufficient[_\s-]?quota/i.test(text)
    || /quota[_\s-]?(exceeded|exhausted|insufficient)/i.test(text)
    || /(credit|account)?\s*balance\s*(is\s*)?(too low|insufficient|not enough|exhausted|used up)/i.test(text)
    || /(余额|额度|令牌额度).*(不足|用尽|已用尽|耗尽|已耗尽)/.test(text)
    || /该令牌额度已用尽/.test(text)
  );
}

function hasAuthText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('unauthorized')
    || lower.includes('forbidden')
    || lower.includes('invalid api key')
    || lower.includes('invalid token')
    || lower.includes('authentication')
    || lower.includes('permission denied')
    || lower.includes('api key is invalid')
    || lower.includes('incorrect api key')
    || lower.includes('未提供令牌')
    || lower.includes('无效令牌')
    || lower.includes('鉴权失败')
    || lower.includes('认证失败')
  );
}

function hasModelUnavailableText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('model_not_found')
    || lower.includes('model not found')
    || lower.includes('model_not_supported')
    || lower.includes('model is not available')
    || lower.includes('model does not exist')
    || lower.includes('unknown model')
    || lower.includes('unsupported model')
    || lower.includes('invalid model')
    || lower.includes('暂不支持')
    || lower.includes('不支持该模型')
    || lower.includes('模型不存在')
    || lower.includes('模型未找到')
    || lower.includes('模型不可用')
    || (lower.includes('model') && (
      lower.includes('not found')
      || lower.includes('not available')
      || lower.includes('not supported')
      || lower.includes('unsupported')
      || lower.includes('does not exist')
    ))
  );
}

function hasNetworkUnavailableText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('fetch failed')
    || lower.includes('econnrefused')
    || lower.includes('econnreset')
    || lower.includes('enotfound')
    || lower.includes('etimedout')
    || lower.includes('socket hang up')
    || lower.includes('network')
    || lower.includes('bad gateway')
    || lower.includes('gateway timeout')
    || lower.includes('service unavailable')
  );
}

function success(): ProviderHealthClassification {
  return {
    status: 'available',
    ok: true,
    retryable: false,
    message: '服务商探测成功，当前模型可以返回响应。',
  };
}

export function classifyProviderProbeResult(raw: RawProbeResult): ProviderHealthClassification {
  if (raw.ok) {
    return success();
  }

  const diagnostic = stringifyProviderProbeDiagnostic(raw);
  const status = raw.httpStatus;

  if (raw.timedOut || isAbortLikeError(raw.error)) {
    return {
      status: 'timeout',
      ok: false,
      retryable: true,
      message: '服务商探测超时。通常表示上游排队、网络慢或网关没有及时返回。',
    };
  }

  if (status === 402 || hasQuotaText(diagnostic)) {
    return {
      status: 'quota_exhausted',
      ok: false,
      retryable: false,
      message: '服务商额度或令牌额度已耗尽。请充值、增加额度或切换服务商后再试。',
    };
  }

  if (status === 401 || status === 403 || hasAuthText(diagnostic)) {
    return {
      status: 'auth_failed',
      ok: false,
      retryable: false,
      message: '服务商鉴权失败。请检查 API Key、登录状态或后台 token 是否仍有效。',
    };
  }

  if (hasModelUnavailableText(diagnostic) || status === 404) {
    return {
      status: 'model_unavailable',
      ok: false,
      retryable: false,
      message: '服务商可访问，但当前模型不可用或没有在该通道开放。请切换模型或检查后台模型映射。',
    };
  }

  if (status === 429) {
    return {
      status: 'upstream_rate_limited_or_unavailable',
      ok: false,
      retryable: true,
      message: '服务商返回 429。对服务站/上游通道来说，这通常表示上游通道当前被限流、排队或不可用；不等于用户刚刚发了太多请求。',
    };
  }

  if (
    status === 408
    || status === 500
    || status === 502
    || status === 503
    || status === 504
    || status === 520
    || status === 521
    || status === 522
    || status === 523
    || status === 524
    || hasNetworkUnavailableText(diagnostic)
  ) {
    return {
      status: 'gateway_unavailable',
      ok: false,
      retryable: true,
      message: '服务商网关或上游模型服务当前不可用。请稍后重试，或临时切换到其它服务商。',
    };
  }

  return {
    status: 'unknown_error',
    ok: false,
    retryable: true,
    message: '服务商探测失败，但错误类型暂未能明确归类。请查看后台日志或切换服务商重试。',
  };
}

