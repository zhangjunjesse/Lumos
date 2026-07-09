import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getSetting } from '@/lib/db/sessions'
import { getProviderEffectiveDefaultModel } from '@/lib/claude/provider-env'
import { resolveProviderForCapability } from '@/lib/provider-resolver'
import { createMediaRecord, MEDIA_DIR } from '@/lib/image/persist'
import { parseProviderExtraEnvObject } from '@/lib/image/provider-defaults'
import type { ApiProvider, ProviderModelOption } from '@/types'
import {
  getVideoProviderDefaults,
  mergeVideoProviderOptions,
} from './provider-defaults'
import {
  getVideoModelProfile,
  resolveResolutionParam,
  validateVideoDuration,
  type VideoModelProfile,
} from './model-profiles'
import type {
  GenerateVideoParams,
  GenerateVideoResult,
  GeneratedVideo,
  VideoInput,
  VideoMode,
} from './types'
import { VideoGenError } from './types'

const DEFAULT_BASE_URL = 'https://toapis.com'
const DEFAULT_MODEL = 'wan2.6-flash'
const SUBMIT_PATH = '/v1/videos/generations'
const UPLOAD_IMAGE_PATH = '/v1/uploads/images'
const UPLOAD_VIDEO_PATH = '/v1/uploads/videos'
const INITIAL_WAIT_MS = 3000
const POLL_INTERVAL_MS = 5000
const MAX_WAIT_MS = 30 * 60 * 1000
const MAX_CONSECUTIVE_POLL_ERRORS = 6

type TaskStatus = 'queued' | 'in_progress' | 'processing' | 'completed' | 'failed'

interface ToApisTaskResponse {
  id?: string
  task_id?: string
  status?: TaskStatus
  progress?: number
  model?: string
  result?: unknown
  data?: unknown
  output?: unknown
  video_url?: string
  url?: string
  error?: { code?: string; message?: string }
  message?: string
  fail_reason?: string
}

interface UploadResponse {
  success?: boolean
  message?: string
  data?: { url?: string; mime_type?: string }
  error?: { code?: string; message?: string }
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return { ...authHeaders(apiKey), 'Content-Type': 'application/json' }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VideoGenError('timeout', '请求已取消', false)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  checkAbort(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new VideoGenError('timeout', '请求已取消', false))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    const body = await response.text().catch(() => '')
    throw new VideoGenError(
      'provider_unavailable',
      `ToAPIs 返回了非 JSON 响应 (${response.status}): ${body || 'empty response'}`,
      response.status >= 500,
    )
  }
}

function mapApiError(payload: {
  statusCode?: number
  errorCode?: string
  message?: string
}): VideoGenError {
  const statusCode = payload.statusCode ?? 0
  const code = payload.errorCode?.trim().toLowerCase() || ''
  const message = payload.message?.trim() || '未知错误'

  if (statusCode === 400 || code === 'invalid_request_error') {
    return new VideoGenError('invalid_params', `ToAPIs 视频请求参数错误: ${message}`, false)
  }
  if (statusCode === 401 || code === 'authentication_error' || code === 'unauthorized') {
    return new VideoGenError('invalid_params', `ToAPIs 认证失败: ${message}`, false)
  }
  if (statusCode === 402 || code === 'insufficient_quota') {
    return new VideoGenError('provider_unavailable', `ToAPIs 余额不足: ${message}`, false)
  }
  if (statusCode === 422 || code === 'content_policy_violation') {
    return new VideoGenError('content_policy', `内容审核未通过: ${message}`, false)
  }
  if (statusCode === 429 || code === 'rate_limit_exceeded') {
    return new VideoGenError('rate_limit', `ToAPIs 限流: ${message}`, true)
  }
  if (statusCode >= 500 || code === 'internal_error') {
    return new VideoGenError('provider_unavailable', `ToAPIs 服务异常: ${message}`, true)
  }
  return new VideoGenError('unknown', `ToAPIs 视频生成失败: ${message}`, false)
}

async function handleJsonHttpError(response: Response): Promise<never> {
  const payload = await parseJsonResponse<{
    error?: { code?: string; message?: string }
    message?: string
  }>(response)
  throw mapApiError({
    statusCode: response.status,
    errorCode: payload.error?.code,
    message: payload.error?.message || payload.message,
  })
}

function validatePaths(paths: string[] | undefined, label: string): VideoInput[] {
  const inputs: VideoInput[] = []
  const rejected: Array<{ path: string; reason: string }> = []

  for (const filePath of paths || []) {
    const resolved = path.resolve(filePath)
    try {
      const stat = fs.statSync(resolved)
      if (!stat.isFile()) {
        rejected.push({ path: filePath, reason: 'path is not a regular file' })
        continue
      }
      fs.accessSync(resolved, fs.constants.R_OK)
      inputs.push({ type: 'path', filePath: resolved })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      rejected.push({
        path: filePath,
        reason: code === 'ENOENT' ? 'file does not exist' : `read failed (${code || 'unknown'})`,
      })
    }
  }

  if (rejected.length > 0) {
    const summary = rejected.map(r => `  - ${r.path} (${r.reason})`).join('\n')
    throw new VideoGenError(
      'invalid_params',
      `${label} 中有 ${rejected.length}/${paths?.length || 0} 个路径无法使用，已中止视频生成：\n${summary}`,
      false,
    )
  }
  return inputs
}

function inferMimeFromPath(filePath: string, fallback: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4'
  return fallback
}

function extensionForMime(mimeType: string, fallback: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('webm')) return 'webm'
  if (normalized.includes('quicktime')) return 'mov'
  if (normalized.includes('jpeg')) return 'jpg'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('png')) return 'png'
  return fallback
}

async function inputToFilePart(input: VideoInput, fallbackMime: string): Promise<{ blob: Blob; fileName: string }> {
  if (input.type === 'path') {
    const buffer = fs.readFileSync(input.filePath)
    const mimeType = inferMimeFromPath(input.filePath, fallbackMime)
    return {
      blob: new Blob([Uint8Array.from(buffer)], { type: mimeType }),
      fileName: path.basename(input.filePath),
    }
  }
  if (input.type === 'base64') {
    const mimeType = input.mimeType || fallbackMime
    return {
      blob: new Blob([Uint8Array.from(Buffer.from(input.data, 'base64'))], { type: mimeType }),
      fileName: `reference.${extensionForMime(mimeType, fallbackMime.startsWith('video/') ? 'mp4' : 'png')}`,
    }
  }
  const response = await fetch(input.url)
  if (!response.ok) throw new VideoGenError('invalid_params', `参考素材下载失败: ${input.url}`, false)
  const mimeType = response.headers.get('content-type') || fallbackMime
  return {
    blob: new Blob([await response.arrayBuffer()], { type: mimeType }),
    fileName: `reference.${extensionForMime(mimeType, fallbackMime.startsWith('video/') ? 'mp4' : 'png')}`,
  }
}

async function uploadInput(
  baseUrl: string,
  apiKey: string,
  input: VideoInput,
  kind: 'image' | 'video',
  signal?: AbortSignal,
): Promise<string> {
  checkAbort(signal)
  const { blob, fileName } = await inputToFilePart(input, kind === 'image' ? 'image/png' : 'video/mp4')
  const form = new FormData()
  form.append('file', blob, fileName)
  form.append('purpose', 'generation')
  const response = await fetch(`${baseUrl}${kind === 'image' ? UPLOAD_IMAGE_PATH : UPLOAD_VIDEO_PATH}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: form,
    signal,
  })
  if (!response.ok) await handleJsonHttpError(response)
  const payload = await parseJsonResponse<UploadResponse>(response)
  if (!payload.success || !payload.data?.url) {
    throw mapApiError({
      statusCode: response.status,
      errorCode: payload.error?.code,
      message: payload.error?.message || payload.message || '上传素材未返回 URL',
    })
  }
  return payload.data.url
}

async function resolveUrls(
  baseUrl: string,
  apiKey: string,
  inputs: VideoInput[],
  kind: 'image' | 'video',
  signal?: AbortSignal,
): Promise<string[]> {
  const urls: string[] = []
  for (const input of inputs) {
    if (input.type === 'url' && /^https?:\/\//i.test(input.url)) {
      urls.push(input.url)
      continue
    }
    urls.push(await uploadInput(baseUrl, apiKey, input, kind, signal))
  }
  return urls
}

async function submitTask(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToApisTaskResponse> {
  const response = await fetch(`${baseUrl}${SUBMIT_PATH}`, {
    method: 'POST',
    headers: jsonHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) await handleJsonHttpError(response)
  return parseJsonResponse<ToApisTaskResponse>(response)
}

async function getTaskStatus(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<ToApisTaskResponse> {
  const response = await fetch(`${baseUrl}${SUBMIT_PATH}/${taskId}`, {
    headers: authHeaders(apiKey),
    signal,
  })
  if (!response.ok) await handleJsonHttpError(response)
  return parseJsonResponse<ToApisTaskResponse>(response)
}

function collectStringUrls(value: unknown, output: string[]): void {
  if (!value) return
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStringUrls(item, output))
    return
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    collectStringUrls(record.url, output)
    collectStringUrls(record.video_url, output)
    collectStringUrls(record.videoUrl, output)
    collectStringUrls(record.data, output)
    collectStringUrls(record.videos, output)
  }
}

function extractVideoUrls(payload: ToApisTaskResponse): string[] {
  const urls: string[] = []
  collectStringUrls(payload.result, urls)
  collectStringUrls(payload.output, urls)
  collectStringUrls(payload.data, urls)
  collectStringUrls(payload.video_url, urls)
  collectStringUrls(payload.url, urls)
  return [...new Set(urls)]
}

async function downloadVideo(url: string, signal?: AbortSignal): Promise<GeneratedVideo> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new VideoGenError('provider_unavailable', `视频下载失败: ${url}`, true)
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true })
  const mimeType = response.headers.get('content-type') || 'video/mp4'
  const ext = extensionForMime(mimeType, path.extname(new URL(url).pathname).replace('.', '') || 'mp4')
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`
  const filePath = path.join(MEDIA_DIR, filename)
  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()))
  return {
    mimeType: mimeType.startsWith('video/') ? mimeType : 'video/mp4',
    localPath: filePath,
    url: `/api/media/serve?path=${encodeURIComponent(filePath)}`,
  }
}

function saveReferenceFilesForGallery(paths: string[] | undefined, kind: 'image' | 'video'): Array<{ mimeType: string; localPath: string }> {
  const inputs = validatePaths(paths, kind === 'image' ? 'reference_image_paths' : 'reference_video_paths')
  if (inputs.length === 0) return []
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true })

  return inputs
    .filter((input): input is VideoInput & { type: 'path' } => input.type === 'path')
    .map((input) => {
      const mimeType = inferMimeFromPath(input.filePath, kind === 'image' ? 'image/png' : 'video/mp4')
      const ext = path.extname(input.filePath) || `.${kind === 'image' ? 'png' : 'mp4'}`
      const filename = `${Date.now()}-ref-${crypto.randomBytes(8).toString('hex')}${ext}`
      const localPath = path.join(MEDIA_DIR, filename)
      fs.copyFileSync(input.filePath, localPath)
      return { mimeType, localPath }
    })
}

function firstCatalogModel(provider: ApiProvider): string {
  try {
    const catalog = JSON.parse(provider.model_catalog || '[]') as ProviderModelOption[]
    return catalog.find(item => typeof item.value === 'string' && item.value.trim())?.value.trim() || ''
  } catch {
    return ''
  }
}

function resolveVideoModel(params: GenerateVideoParams, provider: ApiProvider): string {
  return params.model
    || getSetting('model_override:video')?.trim()
    || getProviderEffectiveDefaultModel(provider)
    || firstCatalogModel(provider)
    || DEFAULT_MODEL
}

function inferMode(params: GenerateVideoParams, hasImageRefs: boolean, hasVideoRefs: boolean): VideoMode {
  if (params.mode) return params.mode
  if (hasVideoRefs) return 'video-edit'
  if (hasImageRefs) return 'image-to-video'
  return 'text-to-video'
}

// 请求体字段名和合法值以 docs.toapis.com 各模型 generation 文档为准(单一真源: model-profiles.ts)。
// 参考图走顶层 image_urls,参考视频走 metadata.reference_urls;aspect_ratio/resolution 按模型档案裁剪。
function buildRequestBody(params: {
  prompt: string
  model: string
  profile: VideoModelProfile
  mode: VideoMode
  aspectRatio: string
  resolution: string
  duration: number
  imageUrls: string[]
  videoUrls: string[]
  providerOptions?: Record<string, unknown>
}): Record<string, unknown> {
  const metadata = {
    mode: params.mode,
    ...(params.videoUrls.length ? { reference_urls: params.videoUrls } : {}),
    ...(params.providerOptions?.metadata && typeof params.providerOptions.metadata === 'object'
      ? params.providerOptions.metadata as Record<string, unknown>
      : {}),
  }
  const resolution = resolveResolutionParam(params.profile, params.resolution)
  return {
    model: params.model,
    prompt: params.prompt,
    ...(params.profile.aspectRatios.includes(params.aspectRatio) ? { aspect_ratio: params.aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
    duration: params.duration,
    ...(params.imageUrls.length ? { image_urls: params.imageUrls } : {}),
    metadata,
  }
}

function assertModelInputsSupported(params: {
  model: string
  profile: VideoModelProfile
  mode: VideoMode
  imageCount: number
  videoCount: number
  duration: number
}): void {
  const { model, profile, mode, imageCount, videoCount, duration } = params
  if (!profile.supportsTextToVideo && mode === 'text-to-video' && imageCount === 0 && videoCount === 0) {
    throw new VideoGenError(
      'invalid_params',
      `${model} 官方视频接口暂不支持纯文生视频。请添加参考图/参考视频，或在“设置 → 服务商 → 视频生成”里选择支持文生视频的模型（如 wan2.6 / gemini_omni_flash）。`,
      false,
    )
  }
  const durationCheck = validateVideoDuration(model, duration)
  if (!durationCheck.ok) {
    throw new VideoGenError('invalid_params', durationCheck.error, false)
  }
  if (imageCount > profile.maxReferenceImages) {
    throw new VideoGenError(
      'invalid_params',
      `模型 ${model} 最多接受 ${profile.maxReferenceImages} 张参考图,当前传入 ${imageCount} 张。`,
      false,
    )
  }
  if (videoCount > 0 && !profile.supportsVideoRefs) {
    throw new VideoGenError('invalid_params', `模型 ${model} 不支持参考视频输入。`, false)
  }
  if (profile.imageAndVideoRefsExclusive && imageCount > 0 && videoCount > 0) {
    throw new VideoGenError(
      'invalid_params',
      `模型 ${model} 的参考图与参考视频不可同时使用,请二选一。`,
      false,
    )
  }
}

async function runToApisVideo(
  params: GenerateVideoParams,
  provider: ApiProvider,
  model: string,
): Promise<{
  videos: GeneratedVideo[]
  elapsedMs: number
  model: string
  taskId: string
  mode: VideoMode
  aspectRatio: string
  resolution: string
  duration: number
}> {
  const start = Date.now()
  const providerEnv = parseProviderExtraEnvObject(provider.extra_env)
  const apiKey = provider.api_key || (typeof providerEnv.API_KEY === 'string' ? providerEnv.API_KEY : '') || ''
  if (!apiKey) {
    throw new VideoGenError('invalid_params', `视频生成服务商"${provider.name}"未配置 API Key。`, false)
  }
  const baseUrl = (provider.base_url || DEFAULT_BASE_URL).replace(/\/$/, '')
  const defaults = getVideoProviderDefaults(provider)

  const imageInputs: VideoInput[] = [
    ...validatePaths(params.referenceImagePaths, 'reference_image_paths'),
    ...(params.referenceImageUrls || []).map(url => ({ type: 'url' as const, url })),
    ...(params.referenceImages || []).map(img => ({ type: 'base64' as const, data: img.data, mimeType: img.mimeType })),
  ]
  const videoInputs: VideoInput[] = [
    ...validatePaths(params.referenceVideoPaths, 'reference_video_paths'),
    ...(params.referenceVideoUrls || []).map(url => ({ type: 'url' as const, url })),
  ]
  const mode = inferMode({ ...params, mode: params.mode || defaults.mode }, imageInputs.length > 0, videoInputs.length > 0)
  const profile = getVideoModelProfile(model)
  const aspectRatio = params.aspectRatio || defaults.aspectRatio || '16:9'
  const resolution = params.resolution || defaults.resolution || '720P'
  const duration = params.duration || defaults.duration || profile.defaultDuration
  // 上传参考素材前先做全部本地校验,避免"素材传完了才发现参数非法"白耗流量。
  assertModelInputsSupported({
    model,
    profile,
    mode,
    imageCount: imageInputs.length,
    videoCount: videoInputs.length,
    duration,
  })

  params.onProgress?.({ phase: 'submitting', percent: 0 })
  const [imageUrls, videoUrls] = await Promise.all([
    resolveUrls(baseUrl, apiKey, imageInputs, 'image', params.abortSignal),
    resolveUrls(baseUrl, apiKey, videoInputs, 'video', params.abortSignal),
  ])
  const body = buildRequestBody({
    prompt: params.prompt,
    model,
    profile,
    mode,
    aspectRatio,
    resolution,
    duration,
    imageUrls,
    videoUrls,
    providerOptions: mergeVideoProviderOptions(defaults.providerOptions, params.providerOptions),
  })

  const submitResult = await submitTask(baseUrl, apiKey, body, params.abortSignal)
  const taskId = submitResult.id || submitResult.task_id
  if (!taskId) throw new VideoGenError('provider_unavailable', 'ToAPIs 创建视频任务成功但未返回任务 ID', false)

  await sleep(INITIAL_WAIT_MS, params.abortSignal)
  const deadline = Date.now() + MAX_WAIT_MS
  let latest = submitResult
  let consecutiveErrors = 0

  while (Date.now() < deadline) {
    checkAbort(params.abortSignal)
    try {
      latest = await getTaskStatus(baseUrl, apiKey, taskId, params.abortSignal)
      consecutiveErrors = 0
    } catch (error) {
      if (error instanceof VideoGenError && !error.retryable) throw error
      consecutiveErrors += 1
      if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new VideoGenError('provider_unavailable', `ToAPIs 视频任务轮询连续失败 ${MAX_CONSECUTIVE_POLL_ERRORS} 次 (taskId=${taskId})`, true)
      }
      await sleep(POLL_INTERVAL_MS, params.abortSignal)
      continue
    }

    if (latest.status === 'completed') {
      const urls = extractVideoUrls(latest)
      if (urls.length === 0) throw new VideoGenError('provider_unavailable', 'ToAPIs 视频任务已完成但未返回视频 URL', false)
      params.onProgress?.({ phase: 'downloading', percent: 100 })
      return {
        videos: await Promise.all(urls.map(url => downloadVideo(url, params.abortSignal))),
        elapsedMs: Date.now() - start,
        model: latest.model || model,
        taskId,
        mode,
        aspectRatio,
        resolution,
        duration,
      }
    }
    if (latest.status === 'failed') {
      throw mapApiError({
        errorCode: latest.error?.code,
        message: latest.error?.message || latest.message || latest.fail_reason || '任务失败',
      })
    }
    params.onProgress?.({ phase: 'polling', percent: latest.progress })
    await sleep(POLL_INTERVAL_MS, params.abortSignal)
  }

  throw new VideoGenError('timeout', 'ToAPIs 视频生成超时（30 分钟）', true)
}

export async function generateVideo(params: GenerateVideoParams): Promise<GenerateVideoResult> {
  let provider: ApiProvider | undefined
  try {
    provider = resolveProviderForCapability({
      moduleKey: 'video',
      capability: 'video-gen',
      allowDefault: false,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new VideoGenError('invalid_params', `视频生成服务商解析失败 (settings.provider_override:video): ${detail}`, false)
  }
  if (!provider) {
    throw new VideoGenError(
      'invalid_params',
      '未配置视频生成服务商：请在「设置 → 服务商 → 视频生成」中指定一个支持 video-gen 能力的服务商。',
      false,
    )
  }
  if (provider.provider_type !== 'toapis-video') {
    throw new VideoGenError('invalid_params', `未知的视频服务商类型: ${provider.provider_type}`, false)
  }

  const model = resolveVideoModel(params, provider)
  // 生效参数由 runToApisVideo 一次算出并回传,入库元数据与真实提交值保持一致。
  const result = await runToApisVideo(params, provider, model)
  const metadata: Record<string, unknown> = {
    mediaType: 'video',
    elapsedMs: result.elapsedMs,
    model: result.model,
    mode: result.mode,
    duration: result.duration,
    resolution: result.resolution,
    taskId: result.taskId,
  }
  const referenceImages = saveReferenceFilesForGallery(params.referenceImagePaths, 'image')
  const referenceVideos = saveReferenceFilesForGallery(params.referenceVideoPaths, 'video')
  if (referenceImages.length) metadata.referenceImages = referenceImages
  if (referenceVideos.length) metadata.referenceVideos = referenceVideos

  const mediaId = createMediaRecord({
    type: 'video',
    status: 'completed',
    providerType: provider.provider_type,
    model: result.model,
    prompt: params.prompt,
    aspectRatio: result.aspectRatio,
    imageSize: result.resolution,
    localPath: result.videos[0]?.localPath || '',
    sessionId: params.sessionId,
    metadata,
  })

  return {
    mediaGenerationId: mediaId,
    videos: result.videos,
    elapsedMs: result.elapsedMs,
    model: result.model,
    providerType: provider.provider_type,
    providerName: provider.name,
  }
}
