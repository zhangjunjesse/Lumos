export interface LumosLlmRequestMetadata {
  module?: string
  operation?: string
  sessionId?: string
  runId?: string
  stageId?: string
  requestId?: string
}

const HEADER_PREFIX = 'X-Lumos-'

function sanitizeHeaderValue(value: string | undefined, maxLength = 128): string | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  const ascii = normalized
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/[\r\n:]/g, '_')
    .slice(0, maxLength)
    .trim()
  return ascii || undefined
}

export function buildLumosLlmRequestHeaders(
  metadata?: LumosLlmRequestMetadata,
): Record<string, string> | undefined {
  if (!metadata) return undefined

  const headers: Record<string, string> = {}
  const moduleName = sanitizeHeaderValue(metadata.module, 64)
  const operation = sanitizeHeaderValue(metadata.operation, 64)
  const sessionId = sanitizeHeaderValue(metadata.sessionId, 96)
  const runId = sanitizeHeaderValue(metadata.runId, 96)
  const stageId = sanitizeHeaderValue(metadata.stageId, 96)
  const requestId = sanitizeHeaderValue(metadata.requestId, 96)

  if (moduleName) headers[`${HEADER_PREFIX}Module`] = moduleName
  if (operation) headers[`${HEADER_PREFIX}Operation`] = operation
  if (sessionId) headers[`${HEADER_PREFIX}Session-Id`] = sessionId
  if (runId) headers[`${HEADER_PREFIX}Run-Id`] = runId
  if (stageId) headers[`${HEADER_PREFIX}Stage-Id`] = stageId
  if (requestId) headers[`${HEADER_PREFIX}Request-Id`] = requestId

  return Object.keys(headers).length > 0 ? headers : undefined
}

export function mergeHeaderLines(
  existing: string | undefined,
  headers: Record<string, string> | undefined,
): string | undefined {
  const lines = (existing || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const [key, value] of Object.entries(headers || {})) {
    const safeKey = sanitizeHeaderValue(key, 96)
    const safeValue = sanitizeHeaderValue(value, 160)
    if (!safeKey || !safeValue) continue
    lines.push(`${safeKey}: ${safeValue}`)
  }

  return lines.length > 0 ? lines.join('\n') : undefined
}

