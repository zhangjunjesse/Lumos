import * as fs from 'fs'
import * as path from 'path'
import type { StageExecutionPayloadV1, StageExecutionResultV1 } from './runtime-contracts'

export interface StageExecutionModelArtifactV1 {
  kind: 'file' | 'log' | 'metadata' | 'report'
  title: string
  relativePath: string
  contentType?: string
}

export interface StageExecutionModelOutputV1 {
  outcome: 'done' | 'failed' | 'blocked'
  summary: string
  artifacts?: StageExecutionModelArtifactV1[]
  detailArtifactPath?: string
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  memoryAppend?: string[]
}

const MODEL_OUTPUT_ALLOWED_KINDS = ['file', 'log', 'metadata', 'report'] as const

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRelativePath(rawValue: string): string {
  const normalized = rawValue.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`Invalid artifact path: ${rawValue}`)
  }
  return normalized
}

function inferContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.json':
      return 'application/json'
    case '.md':
    case '.markdown':
      return 'text/markdown'
    case '.csv':
      return 'text/csv'
    case '.log':
    case '.txt':
    default:
      return 'text/plain'
  }
}

function listFilesRecursive(rootDir: string, currentDir: string = rootDir): string[] {
  if (!fs.existsSync(currentDir)) {
    return []
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(rootDir, absolutePath))
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    files.push(path.relative(rootDir, absolutePath).replace(/\\/g, '/'))
  }

  return files.sort()
}

function validateModelArtifact(rawValue: unknown): StageExecutionModelArtifactV1 {
  if (!isObjectRecord(rawValue)) {
    throw new Error('Artifact entry must be an object')
  }
  if (typeof rawValue.kind !== 'string' || !MODEL_OUTPUT_ALLOWED_KINDS.includes(rawValue.kind as any)) {
    throw new Error(`Invalid artifact kind: ${String(rawValue.kind)}`)
  }
  if (typeof rawValue.title !== 'string' || !rawValue.title.trim()) {
    throw new Error('Artifact title is required')
  }
  if (typeof rawValue.relativePath !== 'string' || !rawValue.relativePath.trim()) {
    throw new Error('Artifact relativePath is required')
  }

  return {
    kind: rawValue.kind as StageExecutionModelArtifactV1['kind'],
    title: rawValue.title.trim(),
    relativePath: normalizeRelativePath(rawValue.relativePath),
    ...(typeof rawValue.contentType === 'string' && rawValue.contentType.trim()
      ? { contentType: rawValue.contentType.trim() }
      : {}),
  }
}

export function parseStageExecutionModelOutput(rawValue: unknown): StageExecutionModelOutputV1 {
  if (!isObjectRecord(rawValue)) {
    throw new Error('Structured stage output must be an object')
  }
  if (!['done', 'failed', 'blocked'].includes(String(rawValue.outcome))) {
    throw new Error(`Invalid stage outcome: ${String(rawValue.outcome)}`)
  }
  if (typeof rawValue.summary !== 'string') {
    throw new Error('Structured stage output summary must be a string')
  }

  const artifacts = Array.isArray(rawValue.artifacts)
    ? rawValue.artifacts.map((item) => validateModelArtifact(item))
    : []

  const parsed: StageExecutionModelOutputV1 = {
    outcome: rawValue.outcome as StageExecutionModelOutputV1['outcome'],
    summary: rawValue.summary.trim(),
    ...(artifacts.length > 0 ? { artifacts } : {}),
  }

  if (typeof rawValue.detailArtifactPath === 'string' && rawValue.detailArtifactPath.trim()) {
    parsed.detailArtifactPath = normalizeRelativePath(rawValue.detailArtifactPath)
  }

  if (isObjectRecord(rawValue.error)) {
    if (
      typeof rawValue.error.code !== 'string'
      || typeof rawValue.error.message !== 'string'
      || typeof rawValue.error.retryable !== 'boolean'
    ) {
      throw new Error('Structured stage error must include code, message, and retryable')
    }
    parsed.error = {
      code: rawValue.error.code.trim(),
      message: rawValue.error.message.trim(),
      retryable: rawValue.error.retryable,
    }
  }

  if (Array.isArray(rawValue.memoryAppend)) {
    const memoryAppend = rawValue.memoryAppend
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    if (memoryAppend.length > 0) {
      parsed.memoryAppend = memoryAppend
    }
  }

  return parsed
}

export function buildStageExecutionOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['outcome', 'summary', 'artifacts'],
    properties: {
      outcome: {
        type: 'string',
        enum: ['done', 'failed', 'blocked'],
      },
      summary: {
        type: 'string',
      },
      artifacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'title', 'relativePath'],
          properties: {
            kind: {
              type: 'string',
              enum: [...MODEL_OUTPUT_ALLOWED_KINDS],
            },
            title: {
              type: 'string',
            },
            relativePath: {
              type: 'string',
            },
            contentType: {
              type: 'string',
            },
          },
        },
      },
      detailArtifactPath: {
        type: 'string',
      },
      error: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message', 'retryable'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          retryable: { type: 'boolean' },
        },
      },
      memoryAppend: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  }
}

export function normalizeStageExecutionResult(input: {
  payload: StageExecutionPayloadV1
  modelOutput: StageExecutionModelOutputV1
  startedAt: string
  finishedAt: string
  durationMs: number
}): StageExecutionResultV1 {
  const { payload, modelOutput, startedAt, finishedAt, durationMs } = input
  const outputDir = payload.workspace.artifactOutputDir
  const discoveredPaths = new Set(listFilesRecursive(outputDir))
  const declaredArtifacts = modelOutput.artifacts || []
  const artifacts: StageExecutionResultV1['artifacts'] = []
  const allowedArtifactKinds = new Set(payload.stage.outputContract.artifactKinds)

  for (const artifact of declaredArtifacts) {
    if (!discoveredPaths.has(artifact.relativePath)) {
      throw new Error(`Declared artifact not found in output directory: ${artifact.relativePath}`)
    }
    if (!allowedArtifactKinds.has(artifact.kind)) {
      throw new Error(`Artifact kind ${artifact.kind} is not allowed by the stage contract`)
    }

    const absolutePath = path.join(outputDir, artifact.relativePath)
    const stats = fs.statSync(absolutePath)
    artifacts.push({
      kind: artifact.kind,
      title: artifact.title,
      relativePath: artifact.relativePath,
      contentType: artifact.contentType || inferContentType(absolutePath),
      sizeBytes: stats.size,
    })
  }

  for (const relativePath of Array.from(discoveredPaths)) {
    if (declaredArtifacts.some((artifact) => artifact.relativePath === relativePath)) {
      continue
    }
    const absolutePath = path.join(outputDir, relativePath)
    const stats = fs.statSync(absolutePath)
    if (!allowedArtifactKinds.has('file')) {
      throw new Error(`Artifact file discovered but file artifacts are not allowed: ${relativePath}`)
    }
    artifacts.push({
      kind: 'file',
      title: path.basename(relativePath),
      relativePath,
      contentType: inferContentType(absolutePath),
      sizeBytes: stats.size,
    })
  }

  const detailArtifactPath = modelOutput.detailArtifactPath?.trim()
  if (detailArtifactPath && !artifacts.some((artifact) => artifact.relativePath === detailArtifactPath)) {
    throw new Error(`detailArtifactPath is not present in the normalized artifacts: ${detailArtifactPath}`)
  }

  if (modelOutput.outcome === 'done') {
    if (payload.stage.outputContract.mustProduceSummary && !modelOutput.summary.trim()) {
      throw new Error('A successful stage result must include a non-empty summary')
    }
    if (modelOutput.error) {
      throw new Error('A successful stage result must not include an error payload')
    }
  }

  if (modelOutput.outcome !== 'done' && !modelOutput.error) {
    modelOutput.error = {
      code: modelOutput.outcome === 'blocked' ? 'stage_blocked' : 'stage_failed',
      message: modelOutput.summary.trim() || `Stage ${modelOutput.outcome}`,
      retryable: modelOutput.outcome !== 'blocked',
    }
  }

  if (!payload.stage.outputContract.mayProduceArtifacts && artifacts.length > 0) {
    throw new Error('Artifacts were produced but the stage contract disallows artifacts')
  }

  return {
    contractVersion: 'stage-execution-result/v1',
    runId: payload.runId,
    stageId: payload.stageId,
    attempt: payload.attempt,
    outcome: modelOutput.outcome,
    summary: modelOutput.summary.trim(),
    ...(detailArtifactPath ? { detailArtifactPath } : {}),
    artifacts,
    ...(modelOutput.error ? { error: modelOutput.error } : {}),
    ...(modelOutput.memoryAppend?.length
      ? {
          memoryAppend: modelOutput.memoryAppend.map((content) => ({
            scope: 'agent' as const,
            content,
          })),
        }
      : {}),
    metrics: {
      startedAt,
      finishedAt,
      durationMs,
    },
  }
}
