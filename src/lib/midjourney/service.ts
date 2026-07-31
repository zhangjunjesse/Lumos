/**
 * Midjourney 后续操作的 HTTP 回调业务层。
 *
 * 调用方是 midjourney stdio MCP 进程（resources/mcp-servers/midjourney），
 * route 层只做参数解析（/api/midjourney）。
 *
 * 计费口径：MJ 每提交一次任务收一份钱，与返回几张图无关，所以这里一律按
 * count=1 上报；云端该服务商的 billing_unit 必须配成 task。
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getActiveUserId } from '@/lib/auth/user-service'
import { ImageGenError } from '@/lib/image/types'
import {
  consumeRemoteQuota,
  refundRemoteQuota,
  resolveBillingTarget,
} from '@/lib/tools/image-gen-billing'
import { parseProviderExtraEnvObject } from '@/lib/image/provider-defaults'
import { MidjourneyClient } from './client'
import {
  describeImage,
  inpaint,
  pickImage,
  removeBackground,
  upscale,
  variation,
  type MjOperationContext,
  type MjOperationResult,
  type MjTargetRef,
} from './operations'
import type { MaskRegion } from './mask'

const PROVIDER_TYPE = 'midjourney'

export interface MidjourneyCallParams {
  image_path?: string
  media_generation_id?: string
  index?: number
  prompt?: string
  regions?: MaskRegion[]
  mode?: 'subtle' | 'creative'
  strength?: 'subtle' | 'strong'
  session_id?: string
}

interface PreparedContext {
  ctx: MjOperationContext
  userId?: string
  remoteProviderId: string | null
}

/** 解析当前图片服务商并确认它就是 Midjourney——不是的话后续按钮全都无从谈起。 */
function prepareContext(sessionId?: string): PreparedContext {
  const target = resolveBillingTarget()
  if ('error' in target) throw new ImageGenError('invalid_params', target.error, false)

  if (target.provider.provider_type !== PROVIDER_TYPE) {
    throw new ImageGenError(
      'invalid_params',
      `当前图片服务商是「${target.provider.name}」，不是 Midjourney。`
      + '放大 / 局部重绘 / 抠图这些是 Midjourney 专有能力，请先在「设置 → 图片生成」切换服务商。',
      false,
    )
  }

  const providerEnv = parseProviderExtraEnvObject(target.provider.extra_env)
  const apiKey = target.provider.api_key
    || (typeof providerEnv.API_KEY === 'string' ? providerEnv.API_KEY : '')
  if (!apiKey) {
    throw new ImageGenError('invalid_params', `Midjourney 服务商「${target.provider.name}」未配置 API Key`, false)
  }

  return {
    ctx: {
      client: new MidjourneyClient({ apiKey, baseUrl: target.provider.base_url || undefined }),
      providerType: target.provider.provider_type,
      model: target.model,
      sessionId,
    },
    userId: getActiveUserId() || undefined,
    remoteProviderId: target.remoteProviderId,
  }
}

/** 按扩展名给 data URI 定 MIME —— 把 jpg 标成 png 依赖上游宽容，不是能指望的事。 */
function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

function targetRef(params: MidjourneyCallParams): MjTargetRef {
  if (!params.image_path && !params.media_generation_id) {
    throw new ImageGenError('invalid_params', '需要提供 image_path 或 media_generation_id 指明操作哪张图', false)
  }
  return { imagePath: params.image_path, mediaGenerationId: params.media_generation_id }
}

/** 扣费 → 执行 → 失败退款。MJ 一次任务一份价，count 恒为 1。 */
async function withBilling<T>(
  prepared: PreparedContext,
  run: () => Promise<T>,
): Promise<T> {
  const { userId, remoteProviderId, ctx } = prepared
  if (!userId) return run()

  if (!remoteProviderId) {
    throw new ImageGenError(
      'invalid_params',
      '当前 Midjourney 服务商不是 Lumos Cloud 下发的，无法走中心计费。请在管理端配置后重新登录。',
      false,
    )
  }

  const idempotencyKey = crypto.randomUUID()
  const check = await consumeRemoteQuota({
    userId,
    providerId: remoteProviderId,
    model: ctx.model,
    count: 1,
    idempotencyKey,
  })
  if (!check.ok) throw new ImageGenError('provider_unavailable', check.error, false)

  try {
    return await run()
  } catch (error) {
    await refundRemoteQuota(userId, idempotencyKey)
    throw error
  }
}

export interface MjDescribeResult {
  prompts: string[]
  /** 上传后的公网地址，可直接当后续生成的垫图 URL 用 */
  publicUrl: string
  elapsedMs: number
}

export type MidjourneyCallResult = MjOperationResult | MjDescribeResult

export async function handleMidjourneyCall(
  action: string,
  params: MidjourneyCallParams,
): Promise<MidjourneyCallResult> {
  const prepared = prepareContext(params.session_id)
  const { ctx } = prepared

  switch (action) {
    case 'pick':
      return withBilling(prepared, () => pickImage(ctx, targetRef(params), params.index))

    case 'inpaint': {
      if (!params.regions?.length) {
        throw new ImageGenError('invalid_params', '局部重绘需要 regions 指明重绘哪块区域', false)
      }
      if (!params.prompt) {
        throw new ImageGenError('invalid_params', '局部重绘需要 prompt 描述这块区域要变成什么', false)
      }
      const { regions, prompt } = params
      return withBilling(prepared, () => inpaint(ctx, targetRef(params), regions, prompt))
    }

    case 'upscale':
      return withBilling(prepared, () => upscale(ctx, targetRef(params), params.mode || 'subtle'))

    case 'remove_background':
      return withBilling(prepared, () => removeBackground(ctx, targetRef(params)))

    case 'variation':
      return withBilling(prepared, () => variation(ctx, targetRef(params), params.strength || 'subtle'))

    case 'describe': {
      if (!params.image_path) {
        throw new ImageGenError('invalid_params', 'describe 需要 image_path', false)
      }
      const bytes = fs.readFileSync(params.image_path)
      const base64 = `data:${guessMimeType(params.image_path)};base64,${bytes.toString('base64')}`
      return withBilling(prepared, () => describeImage(ctx, base64))
    }

    default:
      throw new ImageGenError('invalid_params', `未知的 Midjourney 操作: ${action}`, false)
  }
}
