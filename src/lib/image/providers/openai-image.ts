/**
 * OpenAI-compatible image provider — synchronous `/v1/images/generations`.
 *
 * Targets any gateway that speaks the OpenAI image API shape:
 *   POST {base_url}/v1/images/generations
 *   body { model, prompt, size, quality, n, response_format }
 *   resp { data: [{ b64_json } | { url }] }
 *
 * Used for OpenAI direct, dm-fox, new-api / one-api proxies, and other
 * gateways routing gpt-image / dall-e style models. NOT for the async-task
 * `toapis-image` flavor or vendor-native APIs (gemini/dashscope/volcengine).
 *
 * Reference images route to `/v1/images/edits` via multipart when present.
 * Returns base64 inline; URLs are downloaded so the persist layer always
 * sees `GeneratedImage.base64`.
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

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_MODEL = 'gpt-image-1'
const GENERATIONS_PATH = '/v1/images/generations'
const EDITS_PATH = '/v1/images/edits'

type OpenAIQuality = 'auto' | 'low' | 'medium' | 'high' | 'standard' | 'hd'
type OpenAISize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto'

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>
  error?: { message?: string; code?: string; type?: string }
}

/* ── Param mapping ───────────────────────────────────────── */

/**
 * Map lumos size tag (`1K|2K|4K`) + aspectRatio to a concrete OpenAI size
 * string. gpt-image officially supports `1024x1024`, `1536x1024`,
 * `1024x1536`, `auto`. Higher lumos tiers fall back to the same set —
 * OpenAI doesn't expose 2K/4K through this endpoint.
 */
function resolveSize(aspectRatio: string | undefined): OpenAISize {
  const ratio = (aspectRatio || '').trim()
  if (!ratio || ratio === '1:1') return '1024x1024'
  const [w, h] = ratio.split(':').map((n) => parseInt(n, 10))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'auto'
  if (w > h) return '1536x1024'
  if (h > w) return '1024x1536'
  return '1024x1024'
}

function resolveQuality(opts: Record<string, unknown> | undefined): OpenAIQuality {
  const raw = opts?.quality
  if (typeof raw !== 'string') return 'high'
  const normalized = raw.trim().toLowerCase()
  const allowed: OpenAIQuality[] = ['auto', 'low', 'medium', 'high', 'standard', 'hd']
  return allowed.includes(normalized as OpenAIQuality) ? (normalized as OpenAIQuality) : 'high'
}

/* ── HTTP helpers ────────────────────────────────────────── */

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return { ...authHeaders(apiKey), 'Content-Type': 'application/json' }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ImageGenError('timeout', '请求已取消', false)
}

async function parseResponse(resp: Response): Promise<OpenAIImageResponse> {
  const text = await resp.text()
  if (!text) {
    throw new ImageGenError(
      'provider_unavailable',
      `OpenAI 图片接口返回空响应 (status=${resp.status})`,
      resp.status >= 500,
    )
  }
  try {
    return JSON.parse(text) as OpenAIImageResponse
  } catch {
    throw new ImageGenError(
      'provider_unavailable',
      `OpenAI 图片接口返回非 JSON (status=${resp.status}): ${text.slice(0, 200)}`,
      resp.status >= 500,
    )
  }
}

function mapHttpError(status: number, payload: OpenAIImageResponse): ImageGenError {
  const message = payload.error?.message || `HTTP ${status}`
  if (status === 401 || status === 403) {
    return new ImageGenError('invalid_params', `认证失败: ${message}`, false)
  }
  if (status === 402) {
    return new ImageGenError('provider_unavailable', `余额不足: ${message}`, false)
  }
  if (status === 422 || payload.error?.code === 'content_policy_violation') {
    return new ImageGenError('content_policy', `内容审核未通过: ${message}`, false)
  }
  if (status === 429) {
    return new ImageGenError('rate_limit', `限流: ${message}`, true)
  }
  if (status >= 500) {
    return new ImageGenError('provider_unavailable', `网关异常 (${status}): ${message}`, true)
  }
  return new ImageGenError('invalid_params', `请求失败 (${status}): ${message}`, false)
}

async function downloadAsBase64(url: string, signal?: AbortSignal): Promise<GeneratedImage> {
  const resp = await fetch(url, { signal })
  if (!resp.ok) {
    throw new ImageGenError('provider_unavailable', `图片下载失败: ${url}`, true)
  }
  const mimeType = resp.headers.get('content-type')?.toLowerCase().startsWith('image/')
    ? resp.headers.get('content-type')!.toLowerCase()
    : 'image/png'
  const buf = Buffer.from(await resp.arrayBuffer())
  return { base64: buf.toString('base64'), mimeType }
}

async function extractImages(
  payload: OpenAIImageResponse,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const items = payload.data ?? []
  if (items.length === 0) {
    throw new ImageGenError('unknown', 'OpenAI 图片接口返回成功但 data 为空')
  }
  const out: GeneratedImage[] = []
  for (const item of items) {
    if (item.b64_json) {
      out.push({ base64: item.b64_json, mimeType: 'image/png' })
      continue
    }
    if (item.url) {
      out.push(await downloadAsBase64(item.url, signal))
      continue
    }
    throw new ImageGenError('unknown', 'OpenAI 图片接口返回项缺少 b64_json/url 字段')
  }
  return out
}

/* ── Reference images → /v1/images/edits multipart ───────── */

function imageInputToBlob(image: ImageInput): { blob: Blob; fileName: string } {
  if (image.type === 'base64') {
    const buf = Buffer.from(image.data, 'base64')
    const ext = image.mimeType.split('/')[1] || 'png'
    return {
      blob: new Blob([Uint8Array.from(buf)], { type: image.mimeType }),
      fileName: `reference.${ext}`,
    }
  }
  if (image.type === 'path') {
    const buf = fs.readFileSync(image.filePath)
    const fileName = image.filePath.split('/').pop() || 'reference.png'
    return { blob: new Blob([Uint8Array.from(buf)], { type: 'image/png' }), fileName }
  }
  throw new ImageGenError('invalid_params', 'OpenAI 图片接口不支持 url 类型的参考图', false)
}

async function callEdits(
  baseUrl: string,
  apiKey: string,
  request: ImageGenRequest,
  model: string,
  size: OpenAISize,
  quality: OpenAIQuality,
  n: number,
): Promise<OpenAIImageResponse> {
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', request.prompt)
  form.append('size', size)
  form.append('quality', quality)
  form.append('n', String(n))
  form.append('response_format', 'b64_json')
  for (const img of request.images!) {
    const { blob, fileName } = imageInputToBlob(img)
    form.append('image[]', blob, fileName)
  }

  const resp = await fetch(`${baseUrl}${EDITS_PATH}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: form,
    signal: request.abortSignal,
  })
  const payload = await parseResponse(resp)
  if (!resp.ok) throw mapHttpError(resp.status, payload)
  return payload
}

async function callGenerations(
  baseUrl: string,
  apiKey: string,
  request: ImageGenRequest,
  model: string,
  size: OpenAISize,
  quality: OpenAIQuality,
  n: number,
): Promise<OpenAIImageResponse> {
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    size,
    quality,
    n,
    response_format: 'b64_json',
  }
  if (typeof request.seed === 'number') body.seed = request.seed

  const resp = await fetch(`${baseUrl}${GENERATIONS_PATH}`, {
    method: 'POST',
    headers: jsonHeaders(apiKey),
    body: JSON.stringify(body),
    signal: request.abortSignal,
  })
  const payload = await parseResponse(resp)
  if (!resp.ok) throw mapHttpError(resp.status, payload)
  return payload
}

/* ── Provider factory ────────────────────────────────────── */

export function createOpenAIImageProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')

  return {
    type: 'openai-image',
    capabilities: ['text-to-image', 'image-editing', 'multi-reference'],

    async generate(request: ImageGenRequest): Promise<ImageGenResult> {
      checkAbort(request.abortSignal)
      const start = Date.now()
      const model = request.model || DEFAULT_MODEL
      const size = resolveSize(request.aspectRatio)
      const quality = resolveQuality(request.providerOptions)
      const n = Math.max(1, request.n ?? 1)
      const hasReferences = (request.images?.length ?? 0) > 0

      request.onProgress?.({ phase: 'submitting', percent: 0 })
      const payload = hasReferences
        ? await callEdits(baseUrl, config.apiKey, request, model, size, quality, n)
        : await callGenerations(baseUrl, config.apiKey, request, model, size, quality, n)

      request.onProgress?.({ phase: 'downloading', percent: 50 })
      const images = await extractImages(payload, request.abortSignal)

      return {
        images,
        model,
        elapsedMs: Date.now() - start,
      }
    },

    optionsSchema(): ProviderOptionsSchema {
      return {
        quality: {
          type: 'string',
          label: '画质',
          description: 'auto / low / medium / high (gpt-image) 或 standard / hd (dall-e-3)，默认 high',
          defaultValue: 'high',
        },
      }
    },
  }
}
