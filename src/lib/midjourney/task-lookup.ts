/**
 * 从一张已生成的图片反查回它背后的 Midjourney 任务。
 *
 * Agent 手上只有图片路径（generate_image 返回的那批），后续要放大 / 局部重绘 /
 * 抠图就得找回 taskId 和按钮表。出图时这些都写进了
 * media_generations.metadata.providerTaskRef，这里负责查回来并校验还能不能用。
 */

import path from 'path'
import { getDb } from '@/lib/db'
import { ImageGenError } from '@/lib/image/types'
import type { MjButton } from './types'

export interface MjTaskHandle {
  mediaGenerationId: string
  taskId: string
  buttons: MjButton[]
  /** 该图在四宫格中的序号（1-4），对应 MJ 的 U1-U4；单图任务为 1 */
  index: number
  imagePath: string
}

interface MediaRow {
  id: string
  local_path: string
  metadata: string
}

interface TaskRefShape {
  provider?: string
  taskId?: string
  buttons?: MjButton[]
  expiresAt?: number
}

function parseMetadata(raw: string): { taskRef?: TaskRefShape; imagePaths: string[] } {
  try {
    const parsed = JSON.parse(raw || '{}') as {
      providerTaskRef?: TaskRefShape
      imagePaths?: unknown
    }
    return {
      taskRef: parsed.providerTaskRef,
      imagePaths: Array.isArray(parsed.imagePaths) ? parsed.imagePaths.filter((p): p is string => typeof p === 'string') : [],
    }
  } catch {
    return { imagePaths: [] }
  }
}

/**
 * 按图片路径或 media_generation_id 找回任务句柄。
 *
 * 只按文件名匹配而不是全路径：图片会被复制到会话工作目录，Agent 拿到的可能是
 * 副本路径，但文件名是一致的。
 */
export function findTaskHandle(params: {
  imagePath?: string
  mediaGenerationId?: string
}): MjTaskHandle {
  const db = getDb()

  let row: MediaRow | undefined
  if (params.mediaGenerationId) {
    row = db
      .prepare('SELECT id, local_path, metadata FROM media_generations WHERE id = ?')
      .get(params.mediaGenerationId) as MediaRow | undefined
  } else if (params.imagePath) {
    const fileName = path.basename(params.imagePath)
    row = db
      .prepare(
        `SELECT id, local_path, metadata FROM media_generations
         WHERE local_path LIKE ? OR metadata LIKE ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(`%${fileName}`, `%${fileName}%`) as MediaRow | undefined
  }

  if (!row) {
    throw new ImageGenError(
      'invalid_params',
      '找不到这张图的生成记录，无法对它做 Midjourney 后续操作',
      false,
    )
  }

  const { taskRef, imagePaths } = parseMetadata(row.metadata)
  if (taskRef?.provider !== 'midjourney' || !taskRef.taskId) {
    throw new ImageGenError(
      'invalid_params',
      '这张图不是 Midjourney 生成的，不支持放大 / 局部重绘 / 抠图等后续操作',
      false,
    )
  }
  if (taskRef.expiresAt && Date.now() > taskRef.expiresAt) {
    throw new ImageGenError(
      'invalid_params',
      'Midjourney 任务已超过 24 小时有效期，无法再对它操作。请重新生成一张。',
      false,
    )
  }

  const fileName = params.imagePath ? path.basename(params.imagePath) : ''
  const matchedIndex = fileName
    ? imagePaths.findIndex((p) => path.basename(p) === fileName)
    : -1

  return {
    mediaGenerationId: row.id,
    taskId: taskRef.taskId,
    buttons: taskRef.buttons || [],
    index: matchedIndex >= 0 ? matchedIndex + 1 : 1,
    imagePath: matchedIndex >= 0 ? imagePaths[matchedIndex] : row.local_path,
  }
}

/** 在按钮表里找一个动作。找不到时把可用按钮列出来，方便定位是哪一步没做。 */
export function requireButton(buttons: MjButton[], match: (b: MjButton) => boolean, label: string): string {
  const found = buttons.find(match)
  if (!found) {
    const available = buttons.map((b) => b.label || b.emoji).filter(Boolean).join(' / ') || '（无）'
    throw new ImageGenError(
      'invalid_params',
      `当前任务不支持「${label}」。可用操作：${available}。`
      + '（放大 / 局部重绘 / 抠图 / 转视频这些只在选中单张之后才解锁，请先选图。）',
      false,
    )
  }
  return found.customId
}
