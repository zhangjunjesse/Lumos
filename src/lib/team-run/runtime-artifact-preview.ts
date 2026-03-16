import * as path from 'path'
import type { RuntimeArtifactPreviewKind } from '@/types'

export const MAX_RUNTIME_ARTIFACT_TEXT_PREVIEW_BYTES = 256 * 1024
export const MAX_RUNTIME_ARTIFACT_EMBED_PREVIEW_BYTES = 10 * 1024 * 1024

const TEXT_LIKE_EXTENSIONS = new Set([
  '.txt',
  '.log',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.yml',
  '.yaml',
  '.xml',
  '.html',
  '.htm',
  '.sql',
  '.sh',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

function normalizeContentType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() || ''
}

function getExtension(sourcePath?: string): string {
  return sourcePath ? path.extname(sourcePath).toLowerCase() : ''
}

export function getRuntimeArtifactPreviewKind(
  artifact: {
    contentType: string
    size: number
    sourcePath?: string
  },
): RuntimeArtifactPreviewKind | null {
  if (!Number.isFinite(artifact.size) || artifact.size < 0) {
    return null
  }

  const contentType = normalizeContentType(artifact.contentType || '')
  const extension = getExtension(artifact.sourcePath)

  if (
    (contentType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension))
    && artifact.size <= MAX_RUNTIME_ARTIFACT_EMBED_PREVIEW_BYTES
  ) {
    return 'image'
  }

  if (
    (contentType === 'application/pdf' || extension === '.pdf')
    && artifact.size <= MAX_RUNTIME_ARTIFACT_EMBED_PREVIEW_BYTES
  ) {
    return 'pdf'
  }

  if (artifact.size > MAX_RUNTIME_ARTIFACT_TEXT_PREVIEW_BYTES) {
    return null
  }

  if (contentType === 'text/csv' || extension === '.csv') {
    return 'csv'
  }

  if (
    contentType === 'text/markdown'
    || extension === '.md'
    || extension === '.markdown'
  ) {
    return 'markdown'
  }

  if (
    contentType === 'application/json'
    || contentType.endsWith('+json')
    || extension === '.json'
  ) {
    return 'json'
  }

  if (
    contentType.startsWith('text/')
    || contentType === 'application/xml'
    || contentType === 'application/yaml'
    || contentType === 'application/x-yaml'
    || contentType === 'application/javascript'
    || TEXT_LIKE_EXTENSIONS.has(extension)
  ) {
    return 'text'
  }

  return null
}

export function parseRuntimeArtifactCsv(content: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === ',') {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      currentRow.push(currentCell)
      rows.push(currentRow)
      currentRow = []
      currentCell = ''
      continue
    }

    currentCell += char
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell)
    rows.push(currentRow)
  }

  return rows
}

export function normalizeRuntimeArtifactPreviewContent(
  content: string,
  kind: RuntimeArtifactPreviewKind,
): string {
  if (kind !== 'json') {
    return content
  }

  try {
    return `${JSON.stringify(JSON.parse(content), null, 2)}\n`
  } catch {
    return content
  }
}
