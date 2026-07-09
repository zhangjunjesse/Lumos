export type VideoMode = 'text-to-video' | 'image-to-video' | 'reference-to-video' | 'video-edit'

export type VideoInput =
  | { type: 'url'; url: string }
  | { type: 'path'; filePath: string }
  | { type: 'base64'; data: string; mimeType: string }

export interface GenerateVideoParams {
  prompt: string
  model?: string
  mode?: VideoMode
  aspectRatio?: string
  resolution?: string
  duration?: number
  referenceImagePaths?: string[]
  referenceVideoPaths?: string[]
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceImages?: Array<{ mimeType: string; data: string }>
  sessionId?: string
  providerOptions?: Record<string, unknown>
  abortSignal?: AbortSignal
  onProgress?: (progress: { phase: 'submitting' | 'polling' | 'downloading'; percent?: number }) => void
}

export interface GeneratedVideo {
  mimeType: string
  localPath: string
  url: string
}

export interface GenerateVideoResult {
  mediaGenerationId: string
  videos: GeneratedVideo[]
  elapsedMs: number
  model: string
  providerType: string
  providerName: string
}

export type VideoGenErrorCode =
  | 'rate_limit'
  | 'content_policy'
  | 'provider_unavailable'
  | 'invalid_params'
  | 'timeout'
  | 'unknown'

export class VideoGenError extends Error {
  readonly code: VideoGenErrorCode
  readonly retryable: boolean

  constructor(code: VideoGenErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'VideoGenError'
    this.code = code
    this.retryable = retryable
  }
}
