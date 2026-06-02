/**
 * ToAPIs image provider — async task-based image generation gateway.
 *
 * Phase 1 scope:
 * - text-to-image
 * - image-to-image / multi-reference via uploaded image URLs
 * - extreme aspect ratios through body.size
 * - resolution passthrough through metadata.resolution
 * - async submit -> poll -> download lifecycle
 */

import fs from 'fs'
import type {
  GeneratedImage,
  ImageGenRequest,
  ImageGenResult,
  ImageInput,
  ImageProvider,
  ImageProviderConfig,
  ProviderOptionsSchema,
} from '../types'
import { ImageGenError } from '../types'

const DEFAULT_BASE_URL = 'https://toapis.com'
const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview'
const SUBMIT_PATH = '/v1/images/generations'
const UPLOAD_PATH = '/v1/uploads/images'
const INITIAL_WAIT_MS = 2000
const POLL_INTERVAL_MS = 3000
// toapis 单任务实测最长 ~6 分钟，留 ~40% 余量
const MAX_WAIT_MS = 900_000
// 连续 N 次 poll 全部失败才放弃，否则视为网络抖动继续轮询
const MAX_CONSECUTIVE_POLL_ERRORS = 5

type ToApisTaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed'

interface ToApisUploadResponse {
  success?: boolean
  message?: string
  data?: {
    url?: string
    mime_type?: string
  }
  error?: {
    code?: string
    message?: string
  }
}

interface ToApisTaskResponse {
  id?: string
  task_id?: string
  status?: ToApisTaskStatus
  progress?: number
  model?: string
  result?: {
    type?: string
    data?: Array<{
      url?: string
    }>
  }
  error?: {
    code?: string
    message?: string
  }
  message?: string
  fail_reason?: string
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  }
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    ...authHeaders(apiKey),
    'Content-Type': 'application/json',
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ImageGenError('timeout', '请求已取消', false)
  }
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
      reject(new ImageGenError('timeout', '请求已取消', false))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function mapApiError(payload: {
  statusCode?: number
  errorCode?: string
  message?: string
}): ImageGenError {
  const statusCode = payload.statusCode ?? 0
  const errorCode = payload.errorCode?.trim().toLowerCase() || ''
  const message = payload.message?.trim() || '未知错误'

  if (statusCode === 401 || errorCode === 'unauthorized') {
    return new ImageGenError('invalid_params', `ToAPIs 认证失败: ${message}`, false)
  }

  if (statusCode === 402 || errorCode === 'insufficient_quota') {
    return new ImageGenError('provider_unavailable', `ToAPIs 余额不足: ${message}`, false)
  }

  if (statusCode === 404 || errorCode === 'task_not_found') {
    return new ImageGenError('invalid_params', `ToAPIs 任务不存在: ${message}`, false)
  }

  if (statusCode === 422 || errorCode === 'content_policy_violation') {
    return new ImageGenError('content_policy', `内容审核未通过: ${message}`, false)
  }

  if (statusCode === 429 || errorCode === 'rate_limit_exceeded') {
    return new ImageGenError('rate_limit', `ToAPIs 限流: ${message}`, true)
  }

  if (statusCode >= 500 || errorCode === 'internal_error') {
    return new ImageGenError('provider_unavailable', `ToAPIs 服务异常: ${message}`, true)
  }

  return new ImageGenError('unknown', `ToAPIs 图片生成失败: ${message}`, false)
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    const body = await response.text().catch(() => '')
    throw new ImageGenError(
      'provider_unavailable',
      `ToAPIs 返回了非 JSON 响应 (${response.status}): ${body || 'empty response'}`,
      response.status >= 500,
    )
  }
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

function normalizeMimeType(value?: string): string {
  const normalized = value?.trim().toLowerCase() || ''
  if (normalized.startsWith('image/')) {
    return normalized
  }
  return 'image/png'
}

function inferExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'png'
  }
}

async function imageInputToFilePart(image: ImageInput): Promise<{
  blob: Blob
  fileName: string
}> {
  if (image.type === 'path') {
    const buffer = fs.readFileSync(image.filePath)
    const fileName = image.filePath.split('/').pop() || 'reference.png'
    return {
      blob: new Blob([Uint8Array.from(buffer)], { type: 'image/png' }),
      fileName,
    }
  }

  if (image.type === 'base64') {
    const mimeType = normalizeMimeType(image.mimeType)
    const buffer = Buffer.from(image.data, 'base64')
    return {
      blob: new Blob([Uint8Array.from(buffer)], { type: mimeType }),
      fileName: `reference.${inferExtension(mimeType)}`,
    }
  }

  const response = await fetch(image.url)
  if (!response.ok) {
    throw new ImageGenError('invalid_params', `参考图下载失败: ${image.url}`, false)
  }
  const mimeType = normalizeMimeType(response.headers.get('content-type') || 'image/png')
  const buffer = await response.arrayBuffer()
  return {
    blob: new Blob([buffer], { type: mimeType }),
    fileName: `reference.${inferExtension(mimeType)}`,
  }
}

async function uploadImage(
  baseUrl: string,
  apiKey: string,
  image: ImageInput,
  signal?: AbortSignal,
): Promise<string> {
  checkAbort(signal)
  const { blob, fileName } = await imageInputToFilePart(image)
  const form = new FormData()
  form.append('file', blob, fileName)
  form.append('purpose', 'generation')

  const response = await fetch(`${baseUrl}${UPLOAD_PATH}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: form,
    signal,
  })

  if (!response.ok) {
    await handleJsonHttpError(response)
  }

  const payload = await parseJsonResponse<ToApisUploadResponse>(response)
  if (!payload.success || !payload.data?.url) {
    throw mapApiError({
      statusCode: response.status,
      errorCode: payload.error?.code,
      message: payload.error?.message || payload.message || '上传图片未返回 URL',
    })
  }

  return payload.data.url
}

async function resolveReferenceUrls(
  baseUrl: string,
  apiKey: string,
  images: ImageInput[] | undefined,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!images?.length) {
    return []
  }

  const urls: string[] = []
  for (const image of images) {
    if (image.type === 'url' && /^https?:\/\//i.test(image.url)) {
      urls.push(image.url)
      continue
    }

    urls.push(await uploadImage(baseUrl, apiKey, image, signal))
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

  if (!response.ok) {
    await handleJsonHttpError(response)
  }

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

  if (!response.ok) {
    await handleJsonHttpError(response)
  }

  return parseJsonResponse<ToApisTaskResponse>(response)
}

async function downloadAsBase64(url: string, signal?: AbortSignal): Promise<GeneratedImage> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new ImageGenError('provider_unavailable', `图片下载失败: ${url}`, true)
  }
  const mimeType = normalizeMimeType(response.headers.get('content-type') || 'image/png')
  const arrayBuffer = await response.arrayBuffer()
  return {
    base64: Buffer.from(arrayBuffer).toString('base64'),
    mimeType,
  }
}

function buildMetadata(
  request: ImageGenRequest,
  providerOptions: Record<string, unknown>,
  includeResolution: boolean,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}

  if (includeResolution && request.size) {
    metadata.resolution = request.size
  }

  const rawMetadata = providerOptions.metadata
  if (rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)) {
    Object.assign(metadata, rawMetadata as Record<string, unknown>)
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function buildRequestBody(
  request: ImageGenRequest,
  model: string,
  imageUrls: string[],
): Record<string, unknown> {
  const providerOptions = request.providerOptions ?? {}
  // toapis 中转对所有模型(含 gpt-image-*)都用统一的「比例 size + metadata.resolution」格式。
  // 实测：gpt-image-2 用 size="1:1"+resolution 才有渠道；转成像素 1024x1024 反而 no available channel。
  const metadata = buildMetadata(request, providerOptions, true)
  const size = request.aspectRatio

  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    ...(size ? { size } : {}),
    ...(typeof request.n === 'number' ? { n: request.n } : {}),
  }

  if (imageUrls.length > 0) {
    body.image_urls = imageUrls
  }

  if (metadata) {
    body.metadata = metadata
  }

  return body
}

export function createToApisProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')

  return {
    type: 'toapis-image',
    capabilities: ['text-to-image', 'image-editing', 'multi-reference'],

    async generate(request: ImageGenRequest): Promise<ImageGenResult> {
      const start = Date.now()
      const model = request.model || DEFAULT_MODEL

      request.onProgress?.({ phase: 'submitting', percent: 0 })
      const imageUrls = await resolveReferenceUrls(baseUrl, config.apiKey, request.images, request.abortSignal)
      const body = buildRequestBody(request, model, imageUrls)

      const submitResult = await submitTask(baseUrl, config.apiKey, body, request.abortSignal)
      const taskId = submitResult.id || submitResult.task_id
      if (!taskId) {
        throw new ImageGenError('provider_unavailable', 'ToAPIs 创建任务成功但未返回任务 ID', false)
      }

      await sleep(INITIAL_WAIT_MS, request.abortSignal)

      const deadline = Date.now() + MAX_WAIT_MS
      let latest = submitResult
      // 单次 poll 网络抖动（TLS 断开、5xx、429）不应杀死整个 generation。
      // 累计连续失败到阈值才放弃，避免 agent 误判失败重新 submit 导致 toapis 后台任务堆积。
      let consecutiveErrors = 0

      while (Date.now() < deadline) {
        checkAbort(request.abortSignal)

        try {
          latest = await getTaskStatus(baseUrl, config.apiKey, taskId, request.abortSignal)
          consecutiveErrors = 0
        } catch (err) {
          // 非 retryable 的 ImageGenError（取消/401/402/404/422）立即上抛，不要重试
          if (err instanceof ImageGenError && !err.retryable) {
            throw err
          }
          consecutiveErrors += 1
          console.warn(
            `[toapis] poll transient error (${consecutiveErrors}/${MAX_CONSECUTIVE_POLL_ERRORS}) taskId=${taskId}:`,
            err instanceof Error ? err.message : String(err),
          )
          if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            throw new ImageGenError(
              'provider_unavailable',
              `ToAPIs 轮询连续失败 ${MAX_CONSECUTIVE_POLL_ERRORS} 次，放弃任务 (taskId=${taskId})`,
              true,
            )
          }
          await sleep(POLL_INTERVAL_MS, request.abortSignal)
          continue
        }

        const status = latest.status

        if (status === 'completed') {
          const urls = (latest.result?.data ?? [])
            .map((item) => item.url)
            .filter((value): value is string => Boolean(value))
          if (urls.length === 0) {
            throw new ImageGenError('provider_unavailable', 'ToAPIs 任务已完成但未返回图片 URL', false)
          }

          request.onProgress?.({ phase: 'downloading', percent: 100 })
          const images = await Promise.all(
            urls.map((url) => downloadAsBase64(url, request.abortSignal)),
          )
          return {
            images,
            model: latest.model || model,
            elapsedMs: Date.now() - start,
          }
        }

        if (status === 'failed') {
          throw mapApiError({
            errorCode: latest.error?.code,
            message: latest.error?.message || latest.message || latest.fail_reason || '任务失败',
          })
        }

        // toapis 的 progress 字段会长时间谎报（比如一直卡在 10 直到完成瞬间跳到 100），
        // 不透传避免 UI 展示错误数值。
        request.onProgress?.({ phase: 'polling' })
        await sleep(POLL_INTERVAL_MS, request.abortSignal)
      }

      throw new ImageGenError('timeout', 'ToAPIs 图片生成超时（15 分钟）', true)
    },

    optionsSchema(): ProviderOptionsSchema {
      return {
        metadata: {
          type: 'json',
          label: '元数据',
          description: '透传给 ToAPIs 的 metadata 对象，例如 {"resolution":"2K"}',
        },
      }
    },
  }
}
