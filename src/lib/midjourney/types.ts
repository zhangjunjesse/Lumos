/**
 * Midjourney (midjourney-proxy-plus 协议) 类型定义。
 *
 * 供应商实测结论（2026-07-31，api.huiyan-ai.cn）：
 * - 可用：imagine / blend / describe / action / modal
 * - 不可用：shorten、modal 之外的 change/simple-change/upload-discord-images
 * - 提交阶段零校验：非法入参一律返回 code:1，错误只在轮询到终态时才暴露
 */

/** 提交返回的状态码。文档只写了 1/22/other，21 是实测发现的。 */
export const MJ_CODE = {
  /** 提交成功（注意：不代表任务会成功，必须轮询到终态） */
  SUBMITTED: 1,
  /** 任务进入「等待填弹窗」状态，下一步必须调 modal */
  WAITING_MODAL: 21,
  /** 排队中 */
  QUEUED: 22,
  /** 网关无法解析上游响应（上游返回 HTML）——该能力供应商未部署 */
  UPSTREAM_ERROR: 4,
} as const

export type MjTaskStatus =
  | 'NOT_START'
  | 'SUBMITTED'
  | 'IN_PROGRESS'
  | 'MODAL'
  | 'SUCCESS'
  | 'FAILURE'

export type MjBotType = 'MID_JOURNEY' | 'NIJI_JOURNEY'

/** blend 专用比例枚举（imagine 走 prompt 里的 --ar，不用这个） */
export type MjDimensions = 'PORTRAIT' | 'SQUARE' | 'LANDSCAPE'

/**
 * 出图后可点的按钮。四宫格任务只有 U1-U4 / V1-V4 / 🔄；
 * 必须先 action 一个 U(n) 进入单图态，才会解锁
 * Vary(Region) / Remove Background / Animate / Upscale 2x / Zoom / Pan。
 */
export interface MjButton {
  customId: string
  emoji: string
  label: string
}

export interface MjTask {
  id: string
  action: string
  status: MjTaskStatus
  progress: string
  prompt: string
  promptEn: string
  description: string
  state: string
  submitTime: number
  startTime: number
  finishTime: number
  /** 出图地址。带签名且 24 小时后失效，必须立刻下载，不能存 URL。 */
  imageUrl: string
  failReason: string
  buttons: MjButton[]
  properties: { finalPrompt?: string; finalZhPrompt?: string }
}

export interface MjSubmitResponse {
  code: number
  description: string
  result: string
  properties?: Record<string, unknown>
}

export interface MjImagineParams {
  prompt: string
  botType?: MjBotType
  /** 垫图公网 URL，会拼到 prompt 最前面。MJ 不认 base64。 */
  referenceUrls?: string[]
  /** 形如 2:3，转成 --ar 2:3 追加到 prompt 末尾 */
  aspectRatio?: string
  state?: string
}

export interface MjBlendParams {
  /** 2-5 张。少于 2 或多于 5 会提交成功但异步失败。 */
  base64Array: string[]
  dimensions?: MjDimensions
  botType?: MjBotType
  state?: string
}

export interface MjWaitOptions {
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (task: MjTask) => void
}

/** action 提交结果：needsModal 为真时任务停在 MODAL 态，必须接着调 modal。 */
export interface MjActionResult {
  taskId: string
  needsModal: boolean
}
