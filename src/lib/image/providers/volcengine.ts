/**
 * Volcengine (火山引擎) image provider — Doubao Seedream models.
 * API docs: https://www.volcengine.com/docs/82379/1399508
 */

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenRequest,
  ImageGenResult,
  GeneratedImage,
  ProviderOptionsSchema,
} from '../types'
import { ImageGenError } from '../types'

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const DEFAULT_MODEL = 'doubao-seedream-3-0-t2i-250415'
const DEFAULT_GUIDANCE_SCALE = 8.0

const SIZE_MAP: Record<string, string> = {
  '1K': '1024x1024',
  '2K': '2048x2048',
  '4K': '4096x4096',
}

function resolveSize(size?: string): string {
  if (!size) return '1024x1024'
  return SIZE_MAP[size] ?? size
}

async function downloadAsBase64(
  url: string,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new ImageGenError('provider_unavailable', `Failed to download image: ${res.status}`, true)
  }
  const mimeType = (res.headers.get('content-type') || 'image/png').split(';')[0].trim()
  const buf = await res.arrayBuffer()
  return { base64: Buffer.from(buf).toString('base64'), mimeType }
}

export function createVolcengineProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')

  return {
    type: 'volcengine',
    capabilities: ['text-to-image'],

    async generate(request: ImageGenRequest): Promise<ImageGenResult> {
      const start = Date.now()
      const model = request.model || DEFAULT_MODEL
      const opts = request.providerOptions ?? {}
      const seed = request.seed ?? (opts.seed as number | undefined)

      const body: Record<string, unknown> = {
        model,
        prompt: request.prompt,
        size: resolveSize(request.size),
        guidance_scale: (opts.guidance_scale as number) ?? DEFAULT_GUIDANCE_SCALE,
      }
      if (seed !== undefined && seed >= 0) body.seed = seed
      if (opts.watermark !== undefined) body.watermark = opts.watermark
      if (request.n && request.n > 1) body.n = request.n

      const res = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: request.abortSignal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new ImageGenError('provider_unavailable', `Volcengine API error ${res.status}: ${errText}`, true)
      }

      const json = (await res.json()) as { data: Array<{ url?: string; b64_json?: string }> }
      if (!json.data?.length) {
        throw new ImageGenError('unknown', 'Volcengine API returned no images')
      }

      const images: GeneratedImage[] = []
      for (const item of json.data) {
        if (item.b64_json) {
          images.push({ base64: item.b64_json, mimeType: 'image/png' })
        } else if (item.url) {
          images.push(await downloadAsBase64(item.url, request.abortSignal))
        } else {
          throw new ImageGenError('unknown', 'Volcengine response item has neither url nor b64_json')
        }
      }

      return { images, model, elapsedMs: Date.now() - start }
    },

    optionsSchema(): ProviderOptionsSchema {
      return {
        guidance_scale: {
          type: 'number',
          label: '风格强度',
          defaultValue: DEFAULT_GUIDANCE_SCALE,
        },
        watermark: {
          type: 'boolean',
          label: '水印',
        },
      }
    },
  }
}
