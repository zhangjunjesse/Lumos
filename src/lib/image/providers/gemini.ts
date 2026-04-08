/**
 * Gemini image provider — text-to-image & image-editing via @ai-sdk/google.
 */

import { generateImage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import fs from 'fs'
import type { ImageProvider, ImageProviderConfig, ImageGenRequest, ImageGenResult, ImageInput } from '../types'
import { ImageGenError } from '../types'

const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview'

async function resolveImageInputsToBase64(images: ImageInput[]): Promise<string[]> {
  return Promise.all(images.map(async (img) => {
    if (img.type === 'base64') return img.data
    if (img.type === 'path') return fs.readFileSync(img.filePath).toString('base64')
    // url
    const resp = await fetch(img.url)
    if (!resp.ok) throw new ImageGenError('invalid_params', `Failed to fetch image: ${img.url}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    return buf.toString('base64')
  }))
}

export function createGeminiProvider(config: ImageProviderConfig): ImageProvider {
  return {
    type: 'gemini-image',
    capabilities: ['text-to-image', 'image-editing'],

    async generate(request: ImageGenRequest): Promise<ImageGenResult> {
      const start = Date.now()
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseUrl })
      const model = request.model || DEFAULT_MODEL

      const refImages = request.images?.length
        ? await resolveImageInputsToBase64(request.images)
        : []

      const prompt = refImages.length > 0
        ? { text: request.prompt, images: refImages }
        : request.prompt

      const aspectRatio = request.aspectRatio as `${number}:${number}` | undefined
      const imageSize = request.size

      try {
        const { images } = await generateImage({
          model: google.image(model),
          prompt,
          providerOptions: { google: { imageConfig: { aspectRatio, imageSize } } },
          maxRetries: 3,
          abortSignal: request.abortSignal || AbortSignal.timeout(300_000),
        })

        return {
          images: images.map(img => ({
            base64: Buffer.from(img.uint8Array).toString('base64'),
            mimeType: img.mediaType,
          })),
          model,
          elapsedMs: Date.now() - start,
        }
      } catch (err: unknown) {
        if (err instanceof ImageGenError) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throw new ImageGenError('unknown', `Gemini image generation failed: ${msg}`)
      }
    },
  }
}
