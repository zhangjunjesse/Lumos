/**
 * Gemini image provider — full capability wrapper for gemini-*-image-preview models.
 *
 * Native Gemini image API (via @ai-sdk/google) supports:
 *   - text-to-image + multi-reference image editing (files[])
 *   - 10 aspect ratios via providerOptions.google.imageConfig.aspectRatio
 *   - imageSize 1K/2K/4K via imageConfig.imageSize
 *   - safety settings via providerOptions.google.safetySettings
 *   - seed passthrough
 *
 * Gemini path rejects n>1 per call, so n>1 is handled via maxImagesPerCall:1
 * which makes ai.generateImage issue n parallel calls internally.
 *
 * Features the native API does NOT expose (negative prompt, color palette,
 * region bbox, sequential/consistency group) are synthesized into the prompt
 * text so the model can interpret them — same pattern DashScope uses natively.
 */

import { generateImage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import fs from 'fs'
import type {
  ImageProvider, ImageProviderConfig, ImageGenRequest, ImageGenResult,
  ImageInput, ProviderOptionsSchema,
} from '../types'
import { ImageGenError } from '../types'

const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview'

/** Aspect ratios the Gemini image path accepts via imageConfig.aspectRatio. */
const GEMINI_ASPECT_RATIOS = new Set([
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
])

type HarmCategory =
  | 'HARM_CATEGORY_HATE_SPEECH'
  | 'HARM_CATEGORY_DANGEROUS_CONTENT'
  | 'HARM_CATEGORY_HARASSMENT'
  | 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
  | 'HARM_CATEGORY_CIVIC_INTEGRITY'

type HarmThreshold =
  | 'BLOCK_LOW_AND_ABOVE' | 'BLOCK_MEDIUM_AND_ABOVE'
  | 'BLOCK_ONLY_HIGH' | 'BLOCK_NONE' | 'OFF'

interface SafetySetting { category: HarmCategory; threshold: HarmThreshold }

/* ── Input resolution ─────────────────────────────────────── */

async function resolveImageInputs(images: ImageInput[]): Promise<Uint8Array[]> {
  return Promise.all(images.map(async (img) => {
    if (img.type === 'base64') return Buffer.from(img.data, 'base64')
    if (img.type === 'path') return fs.readFileSync(img.filePath)
    const resp = await fetch(img.url)
    if (!resp.ok) {
      throw new ImageGenError('invalid_params', `参考图下载失败: ${img.url}`)
    }
    return new Uint8Array(await resp.arrayBuffer())
  }))
}

/* ── Aspect ratio mapping ─────────────────────────────────── */

function normalizeAspectRatio(raw?: string): `${number}:${number}` | undefined {
  if (!raw) return undefined
  if (GEMINI_ASPECT_RATIOS.has(raw)) return raw as `${number}:${number}`
  console.warn(`[gemini] Unsupported aspect ratio "${raw}", falling back to 1:1`)
  return '1:1'
}

/* ── Prompt synthesis for non-native features ─────────────── */

/**
 * Gemini image models accept natural-language instructions embedded in the prompt
 * (color hints, region hints, consistency hints, negative guidance). This matches
 * Gemini's own cookbook pattern — it understands English imperative instructions.
 */
function buildPromptText(basePrompt: string, opts: Record<string, unknown>): string {
  const parts = [basePrompt.trim()]

  const negative = typeof opts.negative_prompt === 'string' ? opts.negative_prompt.trim() : ''
  if (negative) {
    parts.push(`Do NOT include: ${negative}.`)
  }

  const palette = typeof opts.color_palette === 'string' ? opts.color_palette.trim() : ''
  if (palette) {
    parts.push(`Use this color palette as the dominant color scheme: ${palette}.`)
  }

  const bboxRaw = opts.bbox_list
  if (Array.isArray(bboxRaw) && bboxRaw.length > 0) {
    const coords = bboxRaw
      .filter((b): b is number[] => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number'))
      .map(b => `[x1=${b[0]}, y1=${b[1]}, x2=${b[2]}, y2=${b[3]}]`)
      .join(', ')
    if (coords) {
      parts.push(
        `Modify ONLY the following rectangular regions of the reference image (pixel coordinates): ${coords}. `
        + `Keep the rest of the image unchanged.`,
      )
    }
  }

  if (opts.enable_sequential === true) {
    parts.push(
      'Maintain strict visual consistency: same character identity, clothing, art style, '
      + 'color palette, and lighting as the reference images (if any). This is part of a '
      + 'sequential/storyboard set — treat all outputs as frames from the same scene.',
    )
  }

  return parts.join(' ')
}

/* ── Provider options (native SDK surface) ────────────────── */

type JSONVal = string | number | boolean | null | JSONVal[] | { [k: string]: JSONVal | undefined }

function buildProviderOptions(
  opts: Record<string, unknown>,
  aspectRatio: string | undefined,
  imageSize: string | undefined,
): Record<string, { [k: string]: JSONVal | undefined }> {
  const imageConfig: { [k: string]: JSONVal | undefined } = {}
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio
  if (imageSize) imageConfig.imageSize = imageSize

  const google: { [k: string]: JSONVal | undefined } = {}
  if (Object.keys(imageConfig).length > 0) google.imageConfig = imageConfig

  const safety = normalizeSafetySettings(opts.safety_settings)
  if (safety) google.safetySettings = safety as unknown as JSONVal[]

  return { google }
}

function normalizeSafetySettings(raw: unknown): SafetySetting[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const result: SafetySetting[] = []
  for (const item of raw) {
    if (item && typeof item === 'object'
      && typeof (item as SafetySetting).category === 'string'
      && typeof (item as SafetySetting).threshold === 'string') {
      result.push(item as SafetySetting)
    }
  }
  return result.length > 0 ? result : undefined
}

/* ── Error mapping ────────────────────────────────────────── */

function mapError(err: unknown): ImageGenError {
  if (err instanceof ImageGenError) return err
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  if (lower.includes('safety') || lower.includes('blocked') || lower.includes('prohibited')) {
    return new ImageGenError('content_policy', `内容审核未通过: ${msg}`, false)
  }
  if (lower.includes('rate limit') || lower.includes('quota') || lower.includes('429')) {
    return new ImageGenError('rate_limit', `Gemini 限流: ${msg}`, true)
  }
  if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401')) {
    return new ImageGenError('invalid_params', `Gemini 认证失败: ${msg}`, false)
  }
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return new ImageGenError('timeout', `Gemini 请求超时: ${msg}`, true)
  }
  return new ImageGenError('unknown', `Gemini 图片生成失败: ${msg}`, false)
}

/* ── Provider factory ─────────────────────────────────────── */

export function createGeminiProvider(config: ImageProviderConfig): ImageProvider {
  return {
    type: 'gemini-image',
    capabilities: [
      'text-to-image',
      'image-editing',
      'multi-reference',
      'safety-control',
      'negative-prompt',
    ],

    async generate(request: ImageGenRequest): Promise<ImageGenResult> {
      const start = Date.now()
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      })
      const model = request.model || DEFAULT_MODEL
      const opts = request.providerOptions ?? {}

      const refImages = request.images?.length
        ? await resolveImageInputs(request.images)
        : []

      const promptText = buildPromptText(request.prompt, opts)
      const prompt = refImages.length > 0
        ? { text: promptText, images: refImages }
        : promptText

      const aspectRatio = normalizeAspectRatio(request.aspectRatio)
      const providerOptions = buildProviderOptions(opts, aspectRatio, request.size)

      try {
        const result = await generateImage({
          model: google.image(model),
          prompt,
          n: request.n,
          // Gemini path throws on n>1 per call; force 1-per-call so ai SDK
          // runs n parallel calls internally.
          maxImagesPerCall: 1,
          seed: request.seed,
          providerOptions,
          maxRetries: 2,
          abortSignal: request.abortSignal || AbortSignal.timeout(300_000),
        })

        if (result.images.length === 0) {
          throw new ImageGenError('content_policy', 'Gemini 返回空结果，可能被安全策略过滤', false)
        }

        return {
          images: result.images.map(img => ({
            base64: Buffer.from(img.uint8Array).toString('base64'),
            mimeType: img.mediaType,
          })),
          model,
          elapsedMs: Date.now() - start,
        }
      } catch (err: unknown) {
        throw mapError(err)
      }
    },

    optionsSchema(): ProviderOptionsSchema {
      return {
        negative_prompt: {
          type: 'string',
          label: '负向提示',
          description: '描述不希望出现的内容（通过提示词引导，非原生字段）',
        },
        color_palette: {
          type: 'string',
          label: '色卡',
          description: "主色调描述或十六进制值，如 '#FF5733,#33FF57'（通过提示词引导）",
        },
        bbox_list: {
          type: 'json',
          label: '区域编辑坐标',
          description: '像素坐标数组 [[x1,y1,x2,y2]]（通过提示词引导，仅在有参考图时生效）',
        },
        enable_sequential: {
          type: 'boolean',
          label: '一致性组图',
          description: '强调角色/风格一致（通过提示词引导）',
        },
        safety_settings: {
          type: 'json',
          label: '安全设置',
          description: 'Gemini HarmCategory + HarmBlockThreshold 数组',
        },
      }
    },
  }
}
