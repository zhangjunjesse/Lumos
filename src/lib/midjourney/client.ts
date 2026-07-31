/**
 * Midjourney 客户端 — 提交、轮询、取图。
 *
 * 这一层只管协议，不含业务：ImageProvider 和 MCP 都复用它。
 *
 * 三个必须防住的供应商行为（均为实测）：
 * 1. 提交阶段零校验：传 1 张图 / 空数组 / 连字段都不带，一律返回 code:1
 *    "Submit Success"，错误要等轮询到 FAILURE 才暴露。所以 submit 成功不算数，
 *    waitForTask 到终态才算数。
 * 2. failReason 会误导：blend 图片数量不对，报的却是 "The prompt word format is
 *    incorrect"（blend 根本没有提示词）。所以能在本地校验的一律本地拦，别浪费额度。
 * 3. 出图 URL 带签名、24 小时后失效，必须立刻下载成字节，禁止只存 URL。
 */

import { ImageGenError } from '@/lib/image/types'
import { MJ_CODE } from './types'
import type {
  MjActionResult,
  MjBlendParams,
  MjImagineParams,
  MjSubmitResponse,
  MjTask,
  MjWaitOptions,
} from './types'

const DEFAULT_BASE_URL = 'https://api.huiyan-ai.cn'
const POLL_INTERVAL_MS = 3000
/** relax 模式排队可能很久；实测 fast 下 describe 29s、imagine 72s、inpaint 90s */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
const BLEND_MIN_IMAGES = 2
const BLEND_MAX_IMAGES = 5

export interface MjClientConfig {
  apiKey: string
  baseUrl?: string
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ImageGenError('timeout', 'Midjourney 请求已取消', false)
}

/**
 * 把网关/上游的失败翻译成可读原因。
 * upstream_error 和 model_not_found 是两种不同的「没有这个能力」，要分开讲，
 * 否则用户不知道该找供应商开通还是该换接口。
 */
function mapHttpError(status: number, body: string): ImageGenError {
  if (status === 401) {
    return new ImageGenError('invalid_params', `Midjourney 认证失败: ${body}`, false)
  }
  if (body.includes('upstream_error')) {
    return new ImageGenError(
      'provider_unavailable',
      `该 Midjourney 能力在当前服务商未部署（上游返回了 HTML 而非 JSON）: ${body}`,
      false,
    )
  }
  if (body.includes('model_not_found')) {
    return new ImageGenError(
      'provider_unavailable',
      `该 Midjourney 能力在当前服务商未开通渠道: ${body}`,
      false,
    )
  }
  if (status === 429) {
    return new ImageGenError('rate_limit', `Midjourney 限流: ${body}`, true)
  }
  if (status >= 500) {
    return new ImageGenError('provider_unavailable', `Midjourney 服务异常 (${status}): ${body}`, true)
  }
  return new ImageGenError('invalid_params', `Midjourney 请求失败 (${status}): ${body}`, false)
}

/** 任务终态失败的原因分类。内容审核和参数错要分开，前者不该重试。 */
function mapTaskFailure(task: MjTask): ImageGenError {
  const reason = task.failReason || '未知原因'
  if (/banned|policy|blocked/i.test(reason)) {
    return new ImageGenError('content_policy', `Midjourney 内容审核未通过: ${reason}`, false)
  }
  if (/invalid_parameter|incorrect/i.test(reason)) {
    return new ImageGenError('invalid_params', `Midjourney 参数错误: ${reason}`, false)
  }
  return new ImageGenError('unknown', `Midjourney 任务失败: ${reason}`, false)
}

export class MidjourneyClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: MjClientConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<MjSubmitResponse> {
    checkAbort(signal)
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: '*/*',
      },
      body: JSON.stringify(body),
      signal,
    })

    const text = await response.text()
    if (!response.ok) throw mapHttpError(response.status, text.slice(0, 300))

    let payload: MjSubmitResponse
    try {
      payload = JSON.parse(text) as MjSubmitResponse
    } catch {
      throw mapHttpError(response.status, text.slice(0, 300))
    }

    const accepted: number[] = [MJ_CODE.SUBMITTED, MJ_CODE.QUEUED, MJ_CODE.WAITING_MODAL]
    if (!accepted.includes(payload.code)) {
      throw new ImageGenError(
        'invalid_params',
        `Midjourney 提交被拒 (code=${payload.code}): ${payload.description}`,
        false,
      )
    }
    return payload
  }

  /** 文生图 / 图生图。垫图必须是公网 URL，MJ 不认 base64。 */
  async submitImagine(params: MjImagineParams, signal?: AbortSignal): Promise<string> {
    const segments = [
      ...(params.referenceUrls || []),
      params.prompt.trim(),
      params.aspectRatio ? `--ar ${params.aspectRatio}` : '',
    ].filter(Boolean)

    const payload = await this.post('/mj/submit/imagine', {
      botType: params.botType || 'MID_JOURNEY',
      prompt: segments.join(' '),
      state: params.state,
    }, signal)
    return payload.result
  }

  /** 多图融合。2-5 张，本地先拦——供应商不校验，传错了照样扣钱。 */
  async submitBlend(params: MjBlendParams, signal?: AbortSignal): Promise<string> {
    const count = params.base64Array.length
    if (count < BLEND_MIN_IMAGES || count > BLEND_MAX_IMAGES) {
      throw new ImageGenError(
        'invalid_params',
        `Midjourney blend 需要 ${BLEND_MIN_IMAGES}-${BLEND_MAX_IMAGES} 张图，当前 ${count} 张`,
        false,
      )
    }
    const payload = await this.post('/mj/submit/blend', {
      botType: params.botType || 'MID_JOURNEY',
      base64Array: params.base64Array,
      dimensions: params.dimensions || 'SQUARE',
      state: params.state,
    }, signal)
    return payload.result
  }

  /**
   * 图生文。副作用同样有用：返回的 imageUrl 是这张图在供应商存储上的
   * 公网地址（免鉴权、无过期参数），可直接当 imagine 的垫图 URL 使用——
   * 官方的 upload-discord-images 在该服务商未开通，这是唯一可用的上传通道。
   */
  async submitDescribe(base64: string, signal?: AbortSignal): Promise<string> {
    const payload = await this.post('/mj/submit/describe', { botType: 'MID_JOURNEY', base64 }, signal)
    return payload.result
  }

  /**
   * 点按钮（U/V/放大/抠图/动画/局部重绘入口）。
   * code:21 表示任务停在弹窗态，调用方必须接着调 submitModal。
   */
  async submitAction(taskId: string, customId: string, signal?: AbortSignal): Promise<MjActionResult> {
    const payload = await this.post('/mj/submit/action', { taskId, customId }, signal)
    return { taskId: payload.result, needsModal: payload.code === MJ_CODE.WAITING_MODAL }
  }

  /**
   * 填弹窗（局部重绘）。只能对 submitAction 返回 needsModal 的任务调用；
   * 对普通任务调它会返回 code:1 假成功但什么都不做。
   * mask 为黑白 PNG 的 base64，白色区域重绘、黑色区域保持原样。
   */
  async submitModal(
    taskId: string,
    prompt: string,
    maskBase64: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const payload = await this.post('/mj/submit/modal', { taskId, prompt, maskBase64 }, signal)
    return payload.result
  }

  async fetchTask(taskId: string, signal?: AbortSignal): Promise<MjTask> {
    checkAbort(signal)
    const response = await fetch(`${this.baseUrl}/mj/task/${taskId}/fetch`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: '*/*' },
      signal,
    })
    const text = await response.text()
    if (!response.ok) throw mapHttpError(response.status, text.slice(0, 300))
    try {
      return JSON.parse(text) as MjTask
    } catch {
      // 上游挂掉时会返回 HTML 错误页而不是 JSON，且照样带 200。
      // 不接住的话轮询循环里抛的是裸 SyntaxError，排查时完全看不出是服务商的问题。
      throw mapHttpError(response.status, text.slice(0, 300))
    }
  }

  /** 轮询到终态。submit 返回成功不算数,只有这里返回 SUCCESS 才算真成功。 */
  async waitForTask(taskId: string, options: MjWaitOptions = {}): Promise<MjTask> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      checkAbort(options.signal)
      const task = await this.fetchTask(taskId, options.signal)
      options.onProgress?.(task)

      if (task.status === 'SUCCESS') return task
      if (task.status === 'FAILURE') throw mapTaskFailure(task)

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }

    throw new ImageGenError(
      'timeout',
      `Midjourney 任务 ${taskId} 超过 ${Math.round(timeoutMs / 1000)}s 未完成`,
      true,
    )
  }

  /** 出图 URL 24 小时失效，拿到就得立刻落字节。 */
  async downloadImage(url: string, signal?: AbortSignal): Promise<Buffer> {
    checkAbort(signal)
    const response = await fetch(url, { signal })
    if (!response.ok) {
      throw new ImageGenError(
        'provider_unavailable',
        `Midjourney 出图下载失败 (${response.status})，该地址 24 小时后会失效`,
        true,
      )
    }
    return Buffer.from(await response.arrayBuffer())
  }
}
