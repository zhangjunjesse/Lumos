/**
 * Image generation orchestrator — provider resolution, generation, persistence.
 *
 * Replaces the old generateSingleImage() god-function.
 * Provider logic is in providers/*.ts; persistence in persist.ts.
 */

import fs from 'fs'
import path from 'path'
import { resolveProviderForCapability } from '@/lib/provider-resolver'
import { getSetting, getSession } from '@/lib/db/sessions'
import { ensureProvidersRegistered, resolveImageProvider } from './registry'
import { saveBase64Images, copyToSessionDirectory, createMediaRecord, MEDIA_DIR, DATA_DIR } from './persist'
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
}

/* ── Helpers ─────────────────────────────────────────────── */

function validateAndCollectImages(
  params: GenerateImagesParams,
): ImageInput[] {
  const images: ImageInput[] = []

  if (params.referenceImagePaths?.length) {
    const allowedRoots = [MEDIA_DIR, path.join(DATA_DIR, '.lumos-uploads')]
    if (params.sessionId) {
      try {
        const sess = getSession(params.sessionId)
        if (sess?.working_directory) {
          allowedRoots.push(path.join(sess.working_directory, '.lumos-images'))
          allowedRoots.push(path.join(sess.working_directory, '.lumos-uploads'))
        }
      } catch { /* best effort */ }
    }
    for (const filePath of params.referenceImagePaths) {
      const resolved = path.resolve(filePath)
      const allowed = allowedRoots.some(root => resolved.startsWith(path.resolve(root)))
      if (!allowed) {
        console.warn('[image/generate] Blocked path outside allowed dirs:', filePath)
        continue
      }
      if (fs.existsSync(resolved)) {
        images.push({ type: 'path', filePath: resolved })
      }
    }
  }

  if (params.referenceImages?.length) {
    for (const img of params.referenceImages) {
      images.push({ type: 'base64', data: img.data, mimeType: img.mimeType })
    }
  }

  return images
}

/* ── Main entry ──────────────────────────────────────────── */

export async function generateImages(params: GenerateImagesParams): Promise<GenerateImagesResult> {
  await ensureProvidersRegistered()

  // 1. Resolve provider from settings
  let provider
  try {
    provider = resolveProviderForCapability({
      moduleKey: 'image', capability: 'image-gen', allowDefault: false,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`图片生成服务商解析失败 (settings.provider_override:image): ${detail}`)
  }
  if (!provider) {
    throw new Error(
      '未配置图片生成服务商：settings.provider_override:image 为空。'
      + '请在「设置 → 图片生成」中指定一个支持 image-gen 能力的服务商。',
    )
  }

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

  // 3. Resolve model (explicit > setting override > provider default)
  const modelOverride = getSetting('model_override:image')?.trim()
  const model = params.model || modelOverride || undefined

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
    elapsedMs: elapsed,
    model: result.model,
    appliedAspectRatio: params.aspectRatio || providerDefaults.aspectRatio || '1:1',
    appliedResolution: params.imageSize || providerDefaults.resolution || '1K',
  }
  if (images.length > 0) {
    const refSaved = saveRefImagesForGallery(images)
    if (refSaved.length > 0) metadata.referenceImages = refSaved
  }

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
