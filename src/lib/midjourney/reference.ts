/**
 * 垫图上传 — 把本地图片变成 MJ 能读到的公网 URL。
 *
 * MJ 的 imagine 只认 URL，不吃 base64。官方的 upload-discord-images 接口
 * 在该服务商未开通渠道，唯一可用的通道是 describe：它把图存到供应商存储上，
 * 返回的 imageUrl 是免鉴权、无过期参数的裸地址（实测字节与原图完全一致）。
 *
 * 代价是 describe 本身算一次收费任务。所以这里按图片内容哈希缓存 URL——
 * 电商场景反复拿同一张商品图垫图是常态，不缓存就是反复付钱。
 */

import crypto from 'crypto'
import fs from 'fs'
import type { ImageInput } from '@/lib/image/types'
import { ImageGenError } from '@/lib/image/types'
import type { MidjourneyClient } from './client'

/** 进程内缓存：内容哈希 → 公网 URL。供应商存储上的地址不带过期参数。 */
const urlCache = new Map<string, string>()

function readImageBytes(image: ImageInput): { bytes: Buffer; mimeType: string } {
  if (image.type === 'path') {
    return { bytes: fs.readFileSync(image.filePath), mimeType: 'image/png' }
  }
  if (image.type === 'base64') {
    return { bytes: Buffer.from(image.data, 'base64'), mimeType: image.mimeType || 'image/png' }
  }
  throw new ImageGenError('invalid_params', `不支持的参考图类型: ${(image as { type: string }).type}`, false)
}

async function uploadOne(
  client: MidjourneyClient,
  image: ImageInput,
  signal?: AbortSignal,
): Promise<string> {
  const { bytes, mimeType } = readImageBytes(image)
  const hash = crypto.createHash('sha256').update(bytes).digest('hex')

  const cached = urlCache.get(hash)
  if (cached) return cached

  const taskId = await client.submitDescribe(
    `data:${mimeType};base64,${bytes.toString('base64')}`,
    signal,
  )
  const task = await client.waitForTask(taskId, { signal })
  if (!task.imageUrl) {
    throw new ImageGenError('provider_unavailable', 'Midjourney 垫图上传未返回图片地址', false)
  }

  urlCache.set(hash, task.imageUrl)
  return task.imageUrl
}

/**
 * 把参考图统一成公网 URL。已经是 http(s) 的直接用，不花钱；
 * 本地图每张需要一次 describe 任务（有缓存则免）。
 */
export async function resolveReferenceUrls(
  client: MidjourneyClient,
  images: ImageInput[] | undefined,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!images?.length) return []

  const urls: string[] = []
  for (const image of images) {
    if (image.type === 'url' && /^https?:\/\//i.test(image.url)) {
      urls.push(image.url)
      continue
    }
    urls.push(await uploadOne(client, image, signal))
  }
  return urls
}

/** 仅供测试重置缓存。 */
export function clearReferenceUrlCache(): void {
  urlCache.clear()
}
