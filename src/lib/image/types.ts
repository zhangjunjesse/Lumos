/**
 * Image generation module — core type definitions.
 *
 * Design: Strategy + Registry + Adapter
 * - ImageProvider: strategy interface, each provider implements it
 * - ImageProviderFactory: creates provider instances from config
 * - ImageGenRequest / ImageGenResult: unified I/O contract
 * - providerOptions: escape hatch for provider-specific params
 */

/* ── Capability ──��──────────────────────────────────────── */

export type ImageCapability =
  | 'text-to-image'
  | 'image-editing'
  | 'region-editing'
  | 'sequential-group'
  | 'upscale'
  | 'multi-reference'
  | 'safety-control'
  | 'negative-prompt'

/* ── Image Input ────────────────────────────────────────── */

export type ImageInput =
  | { type: 'base64'; data: string; mimeType: string }
  | { type: 'url'; url: string }
  | { type: 'path'; filePath: string }

/* ── Request / Result ─────��─────────────────────────────── */

export type ImageSize = '1K' | '2K' | '4K'

export interface ImageGenProgress {
  phase: 'submitting' | 'polling' | 'downloading'
  percent?: number
}

export interface ImageGenRequest {
  prompt: string
  model?: string
  images?: ImageInput[]
  n?: number
  size?: ImageSize
  aspectRatio?: string
  seed?: number
  /** Provider-specific params (bbox_list, color_palette, etc.) */
  providerOptions?: Record<string, unknown>
  abortSignal?: AbortSignal
  onProgress?: (progress: ImageGenProgress) => void
}

export interface GeneratedImage {
  base64: string
  mimeType: string
}

export interface ImageGenResult {
  images: GeneratedImage[]
  model: string
  elapsedMs: number
  usage?: { inputTokens?: number; outputTokens?: number }
  /**
   * 异步任务型服务商的任务句柄，由上层落进 media_generations.metadata。
   * 出图之后还能对结果继续操作的服务商需要它（如 Midjourney 的放大 /
   * 局部重绘 / 抠图，都要凭 taskId + customId 定位）。不支持后续操作的
   * 服务商不设置此字段。
   */
  providerTaskRef?: Record<string, unknown>
}

/* ── Error ──────────────────────────────────────────────── */

export type ImageGenErrorCode =
  | 'rate_limit'
  | 'content_policy'
  | 'provider_unavailable'
  | 'invalid_params'
  | 'timeout'
  | 'unknown'

export class ImageGenError extends Error {
  readonly code: ImageGenErrorCode
  readonly retryable: boolean

  constructor(code: ImageGenErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'ImageGenError'
    this.code = code
    this.retryable = retryable
  }
}

/* ── Provider Interface (Strategy) ──────────────────────── */

export interface ProviderParameterDef {
  type: 'string' | 'number' | 'boolean' | 'json'
  label: string
  description?: string
  defaultValue?: unknown
}

export type ProviderOptionsSchema = Record<string, ProviderParameterDef>

export interface ImageProvider {
  readonly type: string
  readonly capabilities: ImageCapability[]
  /**
   * 计费单位。'image'（默认）按张计价；'task' 按任务计价 —— 一次调用出几张
   * 都是一个价。仅用于如实告知调用方，实际扣费以云端 billing_unit 为准。
   */
  readonly billingUnit?: 'image' | 'task'
  generate(request: ImageGenRequest): Promise<ImageGenResult>
  optionsSchema?(): ProviderOptionsSchema
}

/* ── Factory ───────���────────────────────────────────────── */

export interface ImageProviderConfig {
  apiKey: string
  baseUrl?: string
}

export type ImageProviderFactory = (config: ImageProviderConfig) => ImageProvider
