/**
 * Midjourney image provider（midjourney-proxy-plus 协议）。
 *
 * 与其他服务商的本质差别：MJ 一次任务出的是 2×2 四宫格候选，不是 N 张成品。
 * 这里把四宫格在本地切成 4 张返回，并把任务句柄带出去，用户挑中某张之后
 * 可以经内置 MCP 做放大 / 局部重绘 / 抠图 / 转视频。
 *
 * 因此 request.n 对本服务商不生效——MJ 固定给 4 个候选，且出 1 张和出 4 张
 * 一个价。计费按「任务」而非「张」，由云端 billing_unit 控制。
 */

import { MidjourneyClient } from '@/lib/midjourney/client'
import type { MjReferenceMode } from '@/lib/midjourney/types'
import { splitGrid } from '@/lib/midjourney/grid'
import { resolveReferenceUrls } from '@/lib/midjourney/reference'
import type {
  ImageGenRequest,
  ImageGenResult,
  ImageProvider,
  ImageProviderConfig,
} from '../types'
import { ImageGenError } from '../types'

const DEFAULT_MODEL = 'mj-fast'

function parsePercent(progress: string): number | undefined {
  const matched = /(\d+)%/.exec(progress || '')
  return matched ? Number(matched[1]) : undefined
}

export function createMidjourneyProvider(config: ImageProviderConfig): ImageProvider {
  const client = new MidjourneyClient({ apiKey: config.apiKey, baseUrl: config.baseUrl })

  return {
    type: 'midjourney',
    capabilities: ['text-to-image', 'image-editing', 'multi-reference'],
    // 一次任务固定出 4 张候选，出 1 张和出 4 张同价
    billingUnit: 'task',

    async generate(request: ImageGenRequest): Promise<ImageGenResult> {
      const startedAt = Date.now()

      request.onProgress?.({ phase: 'submitting' })
      // 本地图要先上传换成公网 URL（MJ 不吃 base64）；每张未命中缓存的都算一次任务
      const referenceUrls = await resolveReferenceUrls(client, request.images, request.abortSignal)

      // 参考图引用方式(#58):经典垫图 / Omni Reference(--oref) / Style Reference(--sref)。
      // 由调用方经 providerOptions 指定;缺省保持历史行为(经典垫图)。
      const opts = request.providerOptions || {}
      const rawMode = typeof opts.reference_mode === 'string' ? opts.reference_mode : ''
      const referenceMode: MjReferenceMode =
        rawMode === 'oref' || rawMode === 'sref' ? rawMode : 'image-prompt'
      const rawWeight = Number(opts.reference_weight)
      const referenceWeight = Number.isFinite(rawWeight) ? rawWeight : undefined

      const taskId = await client.submitImagine(
        {
          prompt: request.prompt,
          referenceUrls,
          referenceMode,
          ...(referenceWeight !== undefined ? { referenceWeight } : {}),
          aspectRatio: request.aspectRatio,
        },
        request.abortSignal,
      )

      const task = await client.waitForTask(taskId, {
        signal: request.abortSignal,
        onProgress: (current) => {
          request.onProgress?.({ phase: 'polling', percent: parsePercent(current.progress) })
        },
      })

      if (!task.imageUrl) {
        throw new ImageGenError('unknown', `Midjourney 任务 ${task.id} 成功但没有返回图片地址`, false)
      }

      request.onProgress?.({ phase: 'downloading' })
      const grid = await client.downloadImage(task.imageUrl, request.abortSignal)
      const cells = await splitGrid(grid)

      return {
        images: cells.map((cell) => ({
          base64: cell.buffer.toString('base64'),
          mimeType: 'image/png',
        })),
        model: request.model || DEFAULT_MODEL,
        elapsedMs: Date.now() - startedAt,
        // 24 小时内可凭它做后续操作；过期后 MJ 侧任务失效
        providerTaskRef: {
          provider: 'midjourney',
          taskId: task.id,
          buttons: task.buttons,
          finalPrompt: task.properties?.finalPrompt || '',
          expiresAt: task.finishTime + 24 * 60 * 60 * 1000,
          // 参考图上传后的公网地址(#58):回传给调用方,便于自行在 prompt 里拼
          // --oref/--sref 等本层没覆盖的用法,不必再传一次本地图重复上传。
          ...(referenceUrls.length > 0 ? { referenceUrls } : {}),
        },
      }
    },
  }
}
