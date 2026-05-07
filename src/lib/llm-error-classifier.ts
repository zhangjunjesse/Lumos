export type LlmTerminalErrorCode =
  | 'llm_quota_exhausted'
  | 'llm_auth_failed'
  | 'llm_provider_circuit_open'

export interface LlmTerminalErrorClassification {
  code: LlmTerminalErrorCode
  userMessage: string
  retryable: false
  diagnosticText: string
}

const QUOTA_EXHAUSTED_MESSAGE =
  '余额或令牌额度已耗尽，Lumos 已停止本次任务和后续自动重试。请充值、增加 token 额度或切换服务商后再重试。'

const AUTH_FAILED_MESSAGE =
  'API Key 或令牌不可用，Lumos 已停止自动重试。请检查服务商配置、登录状态或 token 是否仍有效。'

function pushDiagnosticText(parts: string[], value: unknown, depth = 0, seen = new Set<unknown>()): void {
  if (value === undefined || value === null || depth > 4) return
  if (typeof value === 'string') {
    if (value.trim()) parts.push(value)
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    parts.push(String(value))
    return
  }
  if (typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  const record = value as Record<string, unknown>
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
  ]) {
    if (key in record) {
      pushDiagnosticText(parts, record[key], depth + 1, seen)
    }
  }
}

export function stringifyLlmError(error: unknown): string {
  const parts: string[] = []
  pushDiagnosticText(parts, error)
  if (parts.length === 0) {
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return parts.join('\n')
}

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  for (const key of ['status', 'statusCode']) {
    const raw = record[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim())
  }
  const response = record.response
  if (response && typeof response === 'object') {
    return getStatusCode(response)
  }
  return undefined
}

export function classifyTerminalLlmError(error: unknown): LlmTerminalErrorClassification | null {
  const code = error && typeof error === 'object'
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  const diagnosticText = stringifyLlmError(error)
  const text = diagnosticText.toLowerCase()
  const statusCode = getStatusCode(error)

  if (code === 'llm_provider_circuit_open') {
    return {
      code: 'llm_provider_circuit_open',
      userMessage: error instanceof Error && error.message ? error.message : QUOTA_EXHAUSTED_MESSAGE,
      retryable: false,
      diagnosticText,
    }
  }

  if (
    /tokenstatusexhausted/i.test(diagnosticText)
    || /insufficient[_\s-]?quota/i.test(diagnosticText)
    || /quota[_\s-]?(exceeded|exhausted|insufficient)/i.test(diagnosticText)
    || /(credit|account)?\s*balance\s*(is\s*)?(too low|insufficient|not enough|exhausted|used up)/i.test(diagnosticText)
    || /(余额|额度|令牌额度).*(不足|用尽|已用尽|耗尽|已耗尽)/.test(diagnosticText)
    || /该令牌额度已用尽/.test(diagnosticText)
    || statusCode === 402
  ) {
    return {
      code: 'llm_quota_exhausted',
      userMessage: QUOTA_EXHAUSTED_MESSAGE,
      retryable: false,
      diagnosticText,
    }
  }

  if (
    statusCode === 401
    || statusCode === 403
    || text.includes('unauthorized')
    || text.includes('forbidden')
    || text.includes('invalid api key')
    || text.includes('invalid token')
    || text.includes('authentication')
    || text.includes('permission denied')
    || text.includes('未提供令牌')
    || text.includes('无效令牌')
    || text.includes('鉴权失败')
    || text.includes('认证失败')
  ) {
    return {
      code: 'llm_auth_failed',
      userMessage: AUTH_FAILED_MESSAGE,
      retryable: false,
      diagnosticText,
    }
  }

  return null
}

