/**
 * DashScope image provider — Wanxiang 2.7 text-to-image & image-editing.
 * Supports sync mode for lightweight models and async polling for pro/4K/batch.
 */

import fs from 'fs'
import type {
  ImageProvider, ImageProviderConfig, ImageGenRequest,
  ImageGenResult, ImageInput, ProviderOptionsSchema,
} from '../types'
import { ImageGenError } from '../types'

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com'
const DEFAULT_MODEL = 'wan2.7-image-pro'
const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 150 // 5 minutes

/** Sync endpoint: multimodal-generation (supports messages format) */
const SYNC_PATH = '/api/v1/services/aigc/multimodal-generation/generation'
/** Async endpoint: image-generation (required for X-DashScope-Async) */
const ASYNC_PATH = '/api/v1/services/aigc/image-generation/generation'

const SIZE_MAP: Record<string, string> = {
  '1K': '1024*1024',
  '2K': '2048*2048',
  '4K': '4096*4096',
}

/* ── Helpers ──────────────────────────────────────────────── */

async function resolveImageInput(img: ImageInput): Promise<string> {
  if (img.type === 'base64') return `data:${img.mimeType};base64,${img.data}`
  if (img.type === 'url') return img.url
  const buf = fs.readFileSync(img.filePath)
  return `data:image/png;base64,${buf.toString('base64')}`
}

function buildMessages(prompt: string, images?: ImageInput[]) {
  const content: Record<string, string>[] = [{ type: 'text', text: prompt }]
  const imagePromises = (images ?? []).map(async (img) => {
    const value = await resolveImageInput(img)
    content.push({ type: 'image', image: value })
  })
  return Promise.all(imagePromises).then(() => [{ role: 'user', content }])
}

/**
 * Wan2.7 HTTP API only supports async mode.
 * Sync endpoint (multimodal-generation) returns "current user api does not support synchronous calls".
 * Always use async for wan2.7 models; keep sync path for potential future non-wan models.
 */
function shouldUseAsync(model: string): boolean {
  return model.startsWith('wan') || model.includes('pro')
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new ImageGenError('timeout', '请求已取消', false)
}

async function handleHttpError(resp: Response) {
  const text = await resp.text().catch(() => '')
  if (resp.status === 429) {
    throw new ImageGenError('rate_limit', `DashScope 限流: ${text}`, true)
  }
  if (resp.status === 400 && text.includes('content')) {
    throw new ImageGenError('content_policy', `内容审核未通过: ${text}`, false)
  }
  throw new ImageGenError('provider_unavailable', `DashScope 请求失败 (${resp.status}): ${text}`, true)
}

async function downloadAsBase64(url: string, signal?: AbortSignal): Promise<string> {
  const resp = await fetch(url, { signal })
  if (!resp.ok) throw new ImageGenError('unknown', `图片下载失败: ${url}`)
  return Buffer.from(await resp.arrayBuffer()).toString('base64')
}

/* ── Sync call ────────────────────────────────────────────── */

async function callSync(
  baseUrl: string, apiKey: string, body: Record<string, unknown>, signal?: AbortSignal,
): Promise<string[]> {
  const resp = await fetch(`${baseUrl}${SYNC_PATH}`, {
    method: 'POST', headers: authHeaders(apiKey), body: JSON.stringify(body), signal,
  })
  if (!resp.ok) await handleHttpError(resp)
  const json = await resp.json()
  return extractUrls(json)
}

/* ── Async call + polling ─────────────────────────────────── */

async function callAsync(
  baseUrl: string, apiKey: string, body: Record<string, unknown>,
  signal?: AbortSignal, onProgress?: ImageGenRequest['onProgress'],
): Promise<string[]> {
  const headers = { ...authHeaders(apiKey), 'X-DashScope-Async': 'enable' }
  const resp = await fetch(`${baseUrl}${ASYNC_PATH}`, {
    method: 'POST', headers, body: JSON.stringify(body), signal,
  })
  if (!resp.ok) await handleHttpError(resp)
  const { output } = await resp.json()
  const taskId: string = output?.task_id
  if (!taskId) throw new ImageGenError('unknown', 'DashScope 未返回 task_id')
  return pollTask(baseUrl, apiKey, taskId, signal, onProgress)
}

async function pollTask(
  baseUrl: string, apiKey: string, taskId: string,
  signal?: AbortSignal, onProgress?: ImageGenRequest['onProgress'],
): Promise<string[]> {
  for (let i = 0; i < MAX_POLLS; i++) {
    checkAbort(signal)
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    checkAbort(signal)

    const resp = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, signal,
    })
    if (!resp.ok) await handleHttpError(resp)
    const json = await resp.json()
    const status: string = json.output?.task_status

    onProgress?.({ phase: 'polling', percent: Math.round(((i + 1) / MAX_POLLS) * 100) })

    if (status === 'SUCCEEDED') return extractUrls(json)
    if (status === 'FAILED') {
      throw new ImageGenError('provider_unavailable', `任务失败: ${json.output?.message ?? '未知错误'}`, true)
    }
  }
  throw new ImageGenError('timeout', '图片生成超时（5分钟）', true)
}

/**
 * Extract image URLs from DashScope response.
 * Sync endpoint returns: output.results[].url
 * Async endpoint returns: output.choices[].message.content[].image
 */
function extractUrls(json: Record<string, unknown>): string[] {
  const output = json.output as Record<string, unknown> | undefined
  if (!output) return []

  // Async format: output.choices[].message.content[].image
  const choices = output.choices as Array<{ message?: { content?: Array<{ image?: string }> } }> | undefined
  if (Array.isArray(choices)) {
    return choices
      .flatMap(c => c.message?.content ?? [])
      .map(item => item.image)
      .filter((u): u is string => !!u)
  }

  // Sync format: output.results[].url
  const results = (output.results ?? []) as { url?: string }[]
  return results.map(r => r.url).filter((u): u is string => !!u)
}

/* ── Provider factory ─────────────────────────────────────── */

export function createDashScopeProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')

  return {
    type: 'dashscope',
    capabilities: ['text-to-image', 'image-editing', 'region-editing', 'sequential-group'],

    async generate(request: ImageGenRequest): Promise<ImageGenResult> {
      const start = Date.now()
      const model = request.model || DEFAULT_MODEL
      const sizeKey = request.size ?? '1K'
      const size = SIZE_MAP[sizeKey] ?? '1024*1024'
      const n = request.n ?? 1
      const opts = request.providerOptions ?? {}

      const messages = await buildMessages(request.prompt, request.images)
      const parameters: Record<string, unknown> = { size, n, watermark: false }
      if (request.seed != null) parameters.seed = request.seed
      // thinking_mode defaults to true per DashScope docs; only disable if explicitly set to false
      if (opts.thinking_mode !== false) parameters.thinking_mode = true
      if (opts.color_palette) parameters.color_palette = opts.color_palette
      if (opts.enable_sequential) parameters.enable_sequential = true
      if (opts.bbox_list) parameters.bbox_list = opts.bbox_list
      if (opts.watermark != null) parameters.watermark = opts.watermark

      const body = { model, input: { messages }, parameters }
      const useAsync = shouldUseAsync(model)

      try {
        request.onProgress?.({ phase: 'submitting' })
        const urls = useAsync
          ? await callAsync(baseUrl, config.apiKey, body, request.abortSignal, request.onProgress)
          : await callSync(baseUrl, config.apiKey, body, request.abortSignal)

        if (urls.length === 0) {
          throw new ImageGenError('unknown', 'DashScope 返回成功但未包含图片 URL')
        }

        request.onProgress?.({ phase: 'downloading' })
        const images = await Promise.all(
          urls.map(url => downloadAsBase64(url, request.abortSignal)),
        )

        return {
          images: images.map(b64 => ({ base64: b64, mimeType: 'image/png' })),
          model,
          elapsedMs: Date.now() - start,
        }
      } catch (err: unknown) {
        if (err instanceof ImageGenError) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throw new ImageGenError('unknown', `DashScope 图片生成失败: ${msg}`)
      }
    },

    optionsSchema(): ProviderOptionsSchema {
      return {
        thinking_mode: { type: 'boolean', label: '思考模式', description: '思考模式（提升创意质量）' },
        color_palette: { type: 'string', label: '色卡', description: "色卡（如 '#FF5733,#33FF57'）" },
        enable_sequential: { type: 'boolean', label: '一致性组图', description: '一致性组图' },
        bbox_list: { type: 'json', label: '区域编辑坐标', description: '区域编辑坐标' },
      }
    },
  }
}
