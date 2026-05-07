import crypto from 'crypto'
import { getDb } from '@/lib/db/connection'
import { classifyTerminalLlmError } from '@/lib/llm-error-classifier'
import type { LumosLlmRequestMetadata } from '@/lib/llm-request-metadata'
import type { ApiProvider } from '@/types'

export interface LlmRequestLogStartParams {
  provider?: ApiProvider
  model?: string
  requestMetadata?: LumosLlmRequestMetadata
  prompt?: string
  messages?: Array<{ role: string; content: string }>
  maxTokens?: number
  transport: 'ai-sdk' | 'claude-agent-sdk' | 'anthropic-fetch'
}

export interface LlmRequestLogHandle {
  id: string
  finish: (params: { status: 'succeeded' | 'failed' | 'blocked'; error?: unknown }) => void
}

export interface LlmRequestLogRow {
  id: string
  transport: string
  module: string
  operation: string
  session_id: string
  run_id: string
  stage_id: string
  request_id: string
  provider_id: string
  provider_name: string
  model: string
  max_tokens: number
  prompt_chars: number
  prompt_hash: string
  prompt_preview: string
  status: 'started' | 'succeeded' | 'failed' | 'blocked'
  error_code: string
  error_message: string
  duration_ms: number
  created_at: string
  updated_at: string
}

export interface LlmRequestLogSummaryRow {
  module: string
  operation: string
  status: string
  count: number
  avg_duration_ms: number
  last_at: string
}

let schemaReady = false

function normalizePromptText(params: Pick<LlmRequestLogStartParams, 'prompt' | 'messages'>): string {
  if (typeof params.prompt === 'string') return params.prompt
  if (!params.messages?.length) return ''
  return params.messages.map((message) => `${message.role}: ${message.content}`).join('\n\n')
}

function promptHash(text: string): string {
  if (!text) return ''
  return crypto.createHash('sha256').update(text).digest('hex')
}

function promptPreview(text: string): string {
  if (process.env.LUMOS_LLM_LOG_PROMPT_PREVIEW !== '1') return ''
  return text.slice(0, 1000)
}

function ensureSchema(): ReturnType<typeof getDb> {
  const db = getDb()
  if (schemaReady) return db
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_request_logs (
      id TEXT PRIMARY KEY,
      transport TEXT NOT NULL DEFAULT '',
      module TEXT NOT NULL DEFAULT '',
      operation TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '',
      stage_id TEXT NOT NULL DEFAULT '',
      request_id TEXT NOT NULL DEFAULT '',
      provider_id TEXT NOT NULL DEFAULT '',
      provider_name TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      max_tokens INTEGER NOT NULL DEFAULT 0,
      prompt_chars INTEGER NOT NULL DEFAULT 0,
      prompt_hash TEXT NOT NULL DEFAULT '',
      prompt_preview TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'started',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_llm_request_logs_created_at ON llm_request_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_request_logs_module ON llm_request_logs(module, operation, created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_request_logs_provider ON llm_request_logs(provider_id, model, created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_request_logs_status ON llm_request_logs(status, created_at);
  `)
  schemaReady = true
  return db
}

function toSqlTimestamp(date = new Date()): string {
  return date.toISOString().replace('T', ' ').split('.')[0]
}

export function startLlmRequestLog(params: LlmRequestLogStartParams): LlmRequestLogHandle {
  const id = crypto.randomUUID()
  const startedAt = Date.now()
  try {
    const db = ensureSchema()
    const promptText = normalizePromptText(params)
    const metadata = params.requestMetadata ?? {}
    db.prepare(`
      INSERT INTO llm_request_logs (
        id, transport, module, operation, session_id, run_id, stage_id, request_id,
        provider_id, provider_name, model, max_tokens, prompt_chars, prompt_hash, prompt_preview,
        status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?, ?)
    `).run(
      id,
      params.transport,
      metadata.module?.trim() || '',
      metadata.operation?.trim() || '',
      metadata.sessionId?.trim() || '',
      metadata.runId?.trim() || '',
      metadata.stageId?.trim() || '',
      metadata.requestId?.trim() || '',
      params.provider?.id || '',
      params.provider?.name || '',
      params.model?.trim() || '',
      Math.max(0, Math.floor(params.maxTokens || 0)),
      promptText.length,
      promptHash(promptText),
      promptPreview(promptText),
      toSqlTimestamp(),
      toSqlTimestamp(),
    )
  } catch (error) {
    console.warn('[llm-request-log] failed to write start log:', error instanceof Error ? error.message : error)
  }

  return {
    id,
    finish: ({ status, error }) => {
      try {
        const db = ensureSchema()
        const terminal = error ? classifyTerminalLlmError(error) : null
        const rawMessage = error instanceof Error ? error.message : (error ? String(error) : '')
        db.prepare(`
          UPDATE llm_request_logs
          SET status=?,
              error_code=?,
              error_message=?,
              duration_ms=?,
              updated_at=?
          WHERE id=?
        `).run(
          status,
          terminal?.code || '',
          terminal?.userMessage || rawMessage.slice(0, 1000),
          Math.max(0, Date.now() - startedAt),
          toSqlTimestamp(),
          id,
        )
      } catch (finishError) {
        console.warn('[llm-request-log] failed to finish log:', finishError instanceof Error ? finishError.message : finishError)
      }
    },
  }
}

export function listLlmRequestLogs(options?: {
  windowHours?: number
  limit?: number
}): { rows: LlmRequestLogRow[]; summary: LlmRequestLogSummaryRow[] } {
  const db = ensureSchema()
  const windowHours = Math.max(1, Math.min(Math.floor(options?.windowHours ?? 24), 24 * 365))
  const limit = Math.max(1, Math.min(Math.floor(options?.limit ?? 50), 200))
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)
  const sinceSql = toSqlTimestamp(since)

  const rows = db.prepare(`
    SELECT *
    FROM llm_request_logs
    WHERE created_at >= ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(sinceSql, limit) as LlmRequestLogRow[]

  const summary = db.prepare(`
    SELECT
      module,
      operation,
      status,
      COUNT(*) AS count,
      ROUND(AVG(duration_ms)) AS avg_duration_ms,
      MAX(created_at) AS last_at
    FROM llm_request_logs
    WHERE created_at >= ?
    GROUP BY module, operation, status
    ORDER BY count DESC, last_at DESC
    LIMIT 50
  `).all(sinceSql) as LlmRequestLogSummaryRow[]

  return { rows, summary }
}
