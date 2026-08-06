/**
 * Image generation orchestrator — provider resolution, generation, persistence.
 *
 * Replaces the old generateSingleImage() god-function.
 * Provider logic is in providers/*.ts; persistence in persist.ts.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { resolveProviderForCapability } from '@/lib/provider-resolver'
import { getSetting } from '@/lib/db/sessions'
import { getProviderEffectiveDefaultModel } from '@/lib/claude/provider-env'
import type { ApiProvider } from '@/types'
import { ensureProvidersRegistered, resolveImageProvider } from './registry'
import { saveBase64Images, copyToSessionDirectory, createMediaRecord } from './persist'
import type { ImageGenRequest, ImageInput, ImageSize } from './types'
import type { SavedImage } from './persist'
import {
  getImageProviderDefaults,
  mergeImageProviderOptions,
  parseProviderExtraEnvObject,
} from './provider-defaults'

/* ── Public I/O types (backward-compatible with old generateSingleImage) ── */

export interface GenerateImagesParams {
  prompt: string
  model?: string
  aspectRatio?: string
  imageSize?: string
  n?: number
  seed?: number
  referenceImages?: Array<{ mimeType: string; data: string }>
  referenceImagePaths?: string[]
  sessionId?: string
  providerOptions?: Record<string, unknown>
  /**
   * 指定本次出图用哪个图片服务商(服务商 id)。用于"按调用者分流"——成员/会话/团队
   * 各自绑不同服务商。留空则走全局默认(provider_override:image),旧行为不变。
   * 由上层 resolveImageProviderId 按就近原则解析后传入,这里只负责透传。
   */
  providerId?: string
  abortSignal?: AbortSignal
  onProgress?: ImageGenRequest['onProgress']
}

export interface GenerateImagesResult {
  mediaGenerationId: string
  images: SavedImage[]
  elapsedMs: number
  model: string
  providerType: string
  providerName: string
  /** 该服务商的计价单位，用于如实回报给调用方（默认按张） */
  billingUnit: 'image' | 'task'
}

/* ── Helpers ─────────────────────────────────────────────── */

/**
 * Validate reference image paths and build provider inputs.
 *
 * Fails LOUD: if the caller passed N paths and any of them can't be used
 * (missing, not a file, unreadable), we throw with the specific path and
 * reason. Silently dropping paths was a bug — the agent got a success
 * response while the provider received zero references, producing a
 * hallucinated result indistinguishable from a correct one.
 *
 * No path allowlist: the agent already has unrestricted filesystem access
 * via Read/Bash/workspace.read tools, so gating image-gen on a narrow
 * MEDIA_DIR/uploads allowlist never bought real security — it only blocked
 * legitimate workflow use cases where paths live in `~/Downloads/...` or
 * any other user directory.
 */
function validateAndCollectImages(
  params: GenerateImagesParams,
): ImageInput[] {
  const images: ImageInput[] = []

  if (params.referenceImagePaths?.length) {
    const rejections: Array<{ path: string; reason: string }> = []
    for (const filePath of params.referenceImagePaths) {
      const resolved = path.resolve(filePath)
      let stat: fs.Stats | undefined
      try {
        stat = fs.statSync(resolved)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        rejections.push({
          path: filePath,
          reason: code === 'ENOENT' ? 'file does not exist' : `stat failed (${code || 'unknown'})`,
        })
        continue
      }
      if (!stat.isFile()) {
        rejections.push({ path: filePath, reason: 'path is not a regular file' })
        continue
      }
      try {
        fs.accessSync(resolved, fs.constants.R_OK)
      } catch {
        rejections.push({ path: filePath, reason: 'file is not readable' })
        continue
      }
      images.push({ type: 'path', filePath: resolved })
    }
    if (rejections.length > 0) {
      const summary = rejections.map(r => `  - ${r.path} (${r.reason})`).join('\n')
      throw new Error(
        `reference_image_paths 中有 ${rejections.length}/${params.referenceImagePaths.length} 个路径无法使用，`
        + `已中止生成以避免 provider 收到不完整的参考图集合。被拒路径：\n${summary}`,
      )
    }
  }

  if (params.referenceImages?.length) {
    for (const img of params.referenceImages) {
      images.push({ type: 'base64', data: img.data, mimeType: img.mimeType })
    }
  }

  return images
}

/* ── In-flight dedupe ────────────────────────────────────── */

/**
 * Concurrent identical generation requests (same prompt + refs + params) share
 * a single in-flight Promise. This prevents agent retries — triggered e.g. by
 * client SSE idle abort while the old tool handler is still awaiting a long
 * toapis poll — from submitting a second task with the same content and
 * piling up work on the provider backend.
 *
 * Entries are evicted when the underlying promise settles (success or
 * failure); a TTL sweep guards against any edge case where settlement is
 * missed.
 */
interface InFlightEntry {
  promise: Promise<GenerateImagesResult>
  startedAt: number
}
const INFLIGHT_TTL_MS = 15 * 60 * 1000
const inFlight = new Map<string, InFlightEntry>()

function sweepExpired(now = Date.now()): void {
  for (const [key, entry] of inFlight) {
    if (now - entry.startedAt > INFLIGHT_TTL_MS) inFlight.delete(key)
  }
}

function computeDedupeKey(params: GenerateImagesParams, providerId: string): string {
  const referenceFingerprints = [
    ...(params.referenceImagePaths || []).map((p) => `path:${p}`),
    ...(params.referenceImages || []).map(
      (r) => `b64:${r.mimeType}:${r.data.length}:${r.data.slice(0, 32)}`,
    ),
  ].sort()
  const parts = [
    providerId,
    params.model || '',
    params.prompt,
    params.imageSize || '',
    params.aspectRatio || '',
    String(params.n ?? 1),
    String(params.seed ?? ''),
    referenceFingerprints.join('|'),
    JSON.stringify(params.providerOptions ?? {}),
  ]
  return crypto.createHash('sha256').update(parts.join('\x00')).digest('hex').slice(0, 32)
}

/* ── Main entry ──────────────────────────────────────────── */

export async function generateImages(params: GenerateImagesParams): Promise<GenerateImagesResult> {
  await ensureProvidersRegistered()

  // Resolve provider up front — needed both for the actual call and for the
  // dedupe key (so identical params but different providers still split).
  let provider: ApiProvider | undefined
  try {
    provider = resolveProviderForCapability({
      moduleKey: 'image', capability: 'image-gen', allowDefault: false,
      // 指定了就用它(校验支持 image-gen);没指定走全局 provider_override:image
      preferredProviderId: params.providerId,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const src = params.providerId ? `指定服务商 ${params.providerId}` : 'settings.provider_override:image'
    throw new Error(`图片生成服务商解析失败 (${src}): ${detail}`)
  }
  if (!provider) {
    throw new Error(
      '未配置图片生成服务商：settings.provider_override:image 为空。'
      + '请在「设置 → 图片生成」中指定一个支持 image-gen 能力的服务商。',
    )
  }

  sweepExpired()
  const dedupeKey = computeDedupeKey(params, provider.id)
  const existing = inFlight.get(dedupeKey)
  if (existing) {
    console.log(`[image/generate] dedupe hit: joining in-flight request (key=${dedupeKey})`)
    return existing.promise
  }

  const promise = executeGenerate(params, provider)
  inFlight.set(dedupeKey, { promise, startedAt: Date.now() })
  const cleanup = () => { inFlight.delete(dedupeKey) }
  promise.then(cleanup, cleanup)
  return promise
}

async function executeGenerate(
  params: GenerateImagesParams,
  provider: ApiProvider,
): Promise<GenerateImagesResult> {
  const providerEnv = parseProviderExtraEnvObject(provider.extra_env)
  const apiKey = provider.api_key || (typeof providerEnv.API_KEY === 'string' ? providerEnv.API_KEY : '') || ''
  const baseUrl = provider.base_url || undefined
  if (!apiKey) {
    throw new Error(
      `图片生成服务商"${provider.name}" (id=${provider.id}, type=${provider.provider_type}) 未配置 API Key。`,
    )
  }
  const providerDefaults = getImageProviderDefaults(provider)

  // 2. Build image inputs (with path security validation)
  const images = validateAndCollectImages(params)

  // 3. Resolve model: explicit > model_override:image > provider effective
  // default (user override > admin-synced LUMOS_DEFAULT_MODEL) > undefined
  // (let upstream SDK pick its own).
  const modelOverride = getSetting('model_override:image')?.trim()
  const effectiveDefault = getProviderEffectiveDefaultModel(provider)
  const model = params.model || modelOverride || effectiveDefault || undefined

  // 4. Call provider
  const imageProvider = resolveImageProvider(
    provider.provider_type,
    { apiKey, baseUrl },
  )
  const result = await imageProvider.generate({
    prompt: params.prompt,
    model,
    images: images.length > 0 ? images : undefined,
    n: params.n ?? providerDefaults.count,
    size: (params.imageSize || providerDefaults.resolution || '1K') as ImageSize,
    aspectRatio: params.aspectRatio || providerDefaults.aspectRatio || '1:1',
    seed: params.seed,
    providerOptions: mergeImageProviderOptions(providerDefaults.providerOptions, params.providerOptions),
    abortSignal: params.abortSignal,
    onProgress: params.onProgress,
  })

  const elapsed = result.elapsedMs
  console.log(`[image/generate] ${provider.provider_type} ${result.model} completed in ${elapsed}ms`)

  // 5. Persist: save to disk
  const savedImages = saveBase64Images(result.images)

  // 6. Copy to session project directory
  if (params.sessionId) {
    copyToSessionDirectory(savedImages, params.sessionId)
  }

  // 7. Save reference images for gallery display
  const metadata: Record<string, unknown> = {
    imageCount: savedImages.length,
    // 全部落盘路径（DB 的 local_path 列只存得下第一张）。后续操作要靠任意一张
    // 图片路径反查回本次生成，以及它在四宫格里的序号。
    imagePaths: savedImages.map(img => img.localPath),
    elapsedMs: elapsed,
    model: result.model,
    appliedAspectRatio: params.aspectRatio || providerDefaults.aspectRatio || '1:1',
    appliedResolution: params.imageSize || providerDefaults.resolution || '1K',
  }
  if (images.length > 0) {
    const refSaved = saveRefImagesForGallery(images)
    if (refSaved.length > 0) metadata.referenceImages = refSaved
  }
  // 异步任务型服务商的句柄（如 MJ 的 taskId + 按钮），后续放大 / 局部重绘 / 抠图靠它定位
  if (result.providerTaskRef) metadata.providerTaskRef = result.providerTaskRef

  // 8. DB record
  const mediaId = createMediaRecord({
    type: 'image',
    status: 'completed',
    providerType: provider.provider_type,
    model: result.model,
    prompt: params.prompt,
    aspectRatio: params.aspectRatio || providerDefaults.aspectRatio || '1:1',
    imageSize: params.imageSize || providerDefaults.resolution || '1K',
    localPath: savedImages[0]?.localPath || '',
    sessionId: params.sessionId,
    metadata,
  })

  return {
    mediaGenerationId: mediaId,
    images: savedImages,
    elapsedMs: elapsed,
    model: result.model,
    providerType: provider.provider_type,
    providerName: provider.name,
    billingUnit: imageProvider.billingUnit ?? 'image',
  }
}

/** Save reference images so the gallery can display them alongside generated results. */
function saveRefImagesForGallery(images: ImageInput[]): SavedImage[] {
  const base64Items = images
    .filter((img): img is ImageInput & { type: 'base64' } => img.type === 'base64')
    .map(img => ({ base64: img.data, mimeType: img.mimeType }))

  const pathItems = images
    .filter((img): img is ImageInput & { type: 'path' } => img.type === 'path')
    .filter(img => fs.existsSync(img.filePath))
    .map(img => ({
      base64: fs.readFileSync(img.filePath).toString('base64'),
      mimeType: 'image/png',
    }))

  return saveBase64Images([...base64Items, ...pathItems])
}
