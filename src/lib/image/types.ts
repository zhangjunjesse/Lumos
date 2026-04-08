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
  generate(request: ImageGenRequest): Promise<ImageGenResult>
  optionsSchema?(): ProviderOptionsSchema
}

/* ── Factory ───────���────────────────────────────────────── */

export interface ImageProviderConfig {
  apiKey: string
  baseUrl?: string
}

export type ImageProviderFactory = (config: ImageProviderConfig) => ImageProvider
