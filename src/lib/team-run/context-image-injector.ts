import * as fs from 'fs'
import * as path from 'path'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { StageExecutionPayloadV1 } from './runtime-contracts'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const MAX_SINGLE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_COUNT = 10

const EXT_TO_MEDIA: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

export interface ContextImage {
  filePath: string
  mediaType: string
  base64: string
}

const TOOL_DRIVEN_SCENE_IMAGE_GENERATION_PATTERNS = [
  /\bgenerate-scenes\b/i,
  /\bscene image generator\b/i,
  /\bgenerate (?:an? |the |all )?scene images?\b/i,
  /\becommerce scene\b/i,
  /场景图生成师/,
  /场景图生成/,
]

function isImageExt(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function listImageFiles(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isFile() && isImageExt(e.name))
      .map(e => e.name)
  } catch {
    return []
  }
}

function extractImagePathsFromText(text: string): string[] {
  const results: string[] = []
  const re = /(?:^|[\s"'(\[,])(\/[^\s"')\],]+\.(?:jpg|jpeg|png|webp|gif|bmp))\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const p = m[1].trim()
    if (p.startsWith('/')) results.push(p)
  }
  return results
}

function collectImagePaths(payload: StageExecutionPayloadV1): string[] {
  const seen = new Set<string>()
  for (const dep of payload.dependencies) {
    for (const ref of dep.artifactRefs) {
      if (isImageExt(ref)) seen.add(ref)
    }
    for (const p of extractImagePathsFromText(dep.summary)) {
      seen.add(p)
    }
    const outputDir = path.join(
      payload.workspace.runWorkspace, 'stages', dep.stageId, 'output',
    )
    for (const name of listImageFiles(outputDir)) {
      seen.add(path.join(outputDir, name))
    }
  }
  return Array.from(seen)
}

export function getContextImageInjectionSkipReason(payload: StageExecutionPayloadV1): string | null {
  const searchable = [
    payload.stageId,
    payload.stage.title,
    payload.stage.description,
    payload.taskContext.userGoal,
    payload.agent.roleName,
    payload.agent.systemPrompt,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join('\n')

  if (!searchable) return null

  const isToolDrivenImageGeneration = TOOL_DRIVEN_SCENE_IMAGE_GENERATION_PATTERNS
    .some((pattern) => pattern.test(searchable))

  return isToolDrivenImageGeneration
    ? 'tool-driven-scene-image-generation'
    : null
}

export function collectContextImages(payload: StageExecutionPayloadV1): ContextImage[] {
  const skipReason = getContextImageInjectionSkipReason(payload)
  if (skipReason) {
    console.log(
      `[ContextImageInjector] Skipping image injection for stage "${payload.stageId}" (${skipReason}); `
      + 'image paths remain available for tool calls.',
    )
    return []
  }

  const paths = collectImagePaths(payload)
  if (paths.length === 0) return []

  const images: ContextImage[] = []
  let totalBytes = 0

  for (const filePath of paths) {
    if (images.length >= MAX_COUNT) break
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size > MAX_SINGLE_BYTES) continue
      if (totalBytes + stat.size > MAX_TOTAL_BYTES) continue

      const data = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      images.push({
        filePath,
        mediaType: EXT_TO_MEDIA[ext] || 'image/png',
        base64: data.toString('base64'),
      })
      totalBytes += stat.size
    } catch {
      continue
    }
  }

  if (images.length > 0) {
    console.log(`[ContextImageInjector] Injecting ${images.length} image(s) into agent context (${(totalBytes / 1024).toFixed(0)} KB)`)
  }
  return images
}

export function buildMultimodalPrompt(
  textPrompt: string,
  images: ContextImage[],
  sessionId: string,
): string | AsyncIterable<SDKUserMessage> {
  if (images.length === 0) return textPrompt

  const refs = images
    .map((img, i) => `[Context Image ${i + 1}: ${img.filePath}]`)
    .join('\n')
  const enrichedText = `${refs}\n\n${textPrompt}`

  type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  type TextBlock = { type: 'text'; text: string }

  const blocks: Array<ImageBlock | TextBlock> = [
    ...images.map((img): ImageBlock => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    })),
    { type: 'text', text: enrichedText },
  ]

  const msg: SDKUserMessage = {
    type: 'user',
    message: { role: 'user', content: blocks },
    parent_tool_use_id: null,
    session_id: sessionId,
  }

  return (async function* () { yield msg })()
}
