/**
 * Midjourney 单图操作 — 选图、局部重绘、放大、抠图、变体。
 *
 * MJ 的交互模型是「四宫格候选 → 选中一张 → 对这张做事」：四宫格任务上只有
 * U/V/🔄，必须先 action 一个 U(n) 进入单图态，才会解锁 Vary(Region)、
 * Remove Background、Upscale 2x、Zoom、Pan。所以除 describe 外的操作都要求
 * 目标图已经是「单图态」的产物，也就是先调用过 pickImage。
 *
 * 每个操作都是一次独立的收费任务，调用方负责计费与失败退款。
 */

import { MidjourneyClient } from './client'
import { splitGrid } from './grid'
import { buildInpaintMask, type MaskRegion } from './mask'
import { findTaskHandle, requireButton } from './task-lookup'
import { ImageGenError } from '@/lib/image/types'
import { saveBase64Images, createMediaRecord } from '@/lib/image/persist'
import type { MjTask } from './types'

/** 结果形态由操作类型决定：MJ 不在响应里区分，只能按动作硬编码。 */
type ResultShape = 'single' | 'grid'

export interface MjTargetRef {
  imagePath?: string
  mediaGenerationId?: string
}

export interface MjOperationResult {
  mediaGenerationId: string
  taskId: string
  images: Array<{ path: string; index: number }>
  elapsedMs: number
}

export interface MjOperationContext {
  client: MidjourneyClient
  providerType: string
  model: string
  sessionId?: string
}

async function persistTaskImages(
  ctx: MjOperationContext,
  task: MjTask,
  shape: ResultShape,
  prompt: string,
  elapsedMs: number,
): Promise<MjOperationResult> {
  if (!task.imageUrl) {
    throw new ImageGenError('unknown', `Midjourney 任务 ${task.id} 完成但没有返回图片`, false)
  }

  const raw = await ctx.client.downloadImage(task.imageUrl)
  const buffers = shape === 'grid'
    ? (await splitGrid(raw)).map((cell) => cell.buffer)
    : [raw]

  const saved = saveBase64Images(
    buffers.map((buffer) => ({ base64: buffer.toString('base64'), mimeType: 'image/png' })),
  )

  const mediaGenerationId = createMediaRecord({
    type: 'image',
    status: 'completed',
    providerType: ctx.providerType,
    model: ctx.model,
    prompt,
    aspectRatio: '',
    imageSize: '',
    localPath: saved[0]?.localPath || '',
    sessionId: ctx.sessionId,
    metadata: {
      imageCount: saved.length,
      imagePaths: saved.map((img) => img.localPath),
      elapsedMs,
      model: ctx.model,
      providerTaskRef: {
        provider: 'midjourney',
        taskId: task.id,
        buttons: task.buttons,
        finalPrompt: task.properties?.finalPrompt || '',
        expiresAt: task.finishTime + 24 * 60 * 60 * 1000,
      },
    },
  })

  return {
    mediaGenerationId,
    taskId: task.id,
    images: saved.map((img, i) => ({ path: img.localPath, index: i + 1 })),
    elapsedMs,
  }
}

/** 点一个按钮然后等结果。needsModal 的按钮（局部重绘入口）不能走这里。 */
async function runButton(
  ctx: MjOperationContext,
  taskId: string,
  customId: string,
  shape: ResultShape,
  prompt: string,
): Promise<MjOperationResult> {
  const startedAt = Date.now()
  const action = await ctx.client.submitAction(taskId, customId)
  if (action.needsModal) {
    throw new ImageGenError(
      'invalid_params',
      '该操作需要填写弹窗参数，请使用对应的专用工具（如局部重绘）',
      false,
    )
  }
  const task = await ctx.client.waitForTask(action.taskId)
  return persistTaskImages(ctx, task, shape, prompt, Date.now() - startedAt)
}

/**
 * 选中四宫格里的一张进入单图态。
 * 这一步本身不提升分辨率（v7 的 U 出来就是单格原尺寸），它的意义是解锁后续操作。
 */
export async function pickImage(
  ctx: MjOperationContext,
  target: MjTargetRef,
  index?: number,
): Promise<MjOperationResult> {
  const handle = findTaskHandle(target)
  const pickIndex = index ?? handle.index
  if (pickIndex < 1 || pickIndex > 4) {
    throw new ImageGenError('invalid_params', `序号必须是 1-4，收到 ${pickIndex}`, false)
  }
  const customId = requireButton(
    handle.buttons,
    (b) => b.customId.includes(`upsample::${pickIndex}::`) && !b.customId.includes('_2x_'),
    `选中第 ${pickIndex} 张`,
  )
  return runButton(ctx, handle.taskId, customId, 'single', `选中第 ${pickIndex} 张`)
}

/**
 * 局部重绘 —— 只改框选区域，画面其余部分逐像素保留。
 * 这是唯一能「换掉商品但保住同一个模特」的路径。
 */
export async function inpaint(
  ctx: MjOperationContext,
  target: MjTargetRef,
  regions: MaskRegion[],
  prompt: string,
): Promise<MjOperationResult> {
  const handle = findTaskHandle(target)
  const customId = requireButton(handle.buttons, (b) => b.customId.includes('Inpaint'), '局部重绘')

  const startedAt = Date.now()
  const action = await ctx.client.submitAction(handle.taskId, customId)
  if (!action.needsModal) {
    throw new ImageGenError('unknown', 'Midjourney 未进入局部重绘的参数填写状态', false)
  }

  const sharp = (await import('sharp')).default
  const { width, height } = await sharp(handle.imagePath).metadata()
  if (!width || !height) {
    throw new ImageGenError('invalid_params', `无法读取图片尺寸: ${handle.imagePath}`, false)
  }

  const mask = await buildInpaintMask(width, height, regions)
  const taskId = await ctx.client.submitModal(action.taskId, prompt, mask)
  const task = await ctx.client.waitForTask(taskId)
  // 局部重绘同样返回四宫格候选，不是单张
  return persistTaskImages(ctx, task, 'grid', prompt, Date.now() - startedAt)
}

/** 2 倍放大。subtle 保守还原，creative 会补细节。 */
export async function upscale(
  ctx: MjOperationContext,
  target: MjTargetRef,
  mode: 'subtle' | 'creative' = 'subtle',
): Promise<MjOperationResult> {
  const handle = findTaskHandle(target)
  const customId = requireButton(
    handle.buttons,
    (b) => b.customId.includes(`upsample_v7_2x_${mode}`),
    `2 倍放大（${mode}）`,
  )
  return runButton(ctx, handle.taskId, customId, 'single', `2 倍放大（${mode}）`)
}

/** 抠掉背景，输出主体。电商上架常用。 */
export async function removeBackground(
  ctx: MjOperationContext,
  target: MjTargetRef,
): Promise<MjOperationResult> {
  const handle = findTaskHandle(target)
  const customId = requireButton(
    handle.buttons,
    (b) => b.customId.includes('background_eraser'),
    '抠图',
  )
  return runButton(ctx, handle.taskId, customId, 'single', '抠图')
}

/** 在当前图基础上出变体。strong 变化大，subtle 变化小。 */
export async function variation(
  ctx: MjOperationContext,
  target: MjTargetRef,
  strength: 'subtle' | 'strong' = 'subtle',
): Promise<MjOperationResult> {
  const handle = findTaskHandle(target)
  const key = strength === 'strong' ? 'high_variation' : 'low_variation'
  const customId = requireButton(handle.buttons, (b) => b.customId.includes(key), `变体（${strength}）`)
  return runButton(ctx, handle.taskId, customId, 'grid', `变体（${strength}）`)
}

/** 图生文：反推 4 条提示词。不需要先选图，任意图片都能用。 */
export async function describeImage(
  ctx: MjOperationContext,
  base64: string,
): Promise<{ prompts: string[]; publicUrl: string; elapsedMs: number }> {
  const startedAt = Date.now()
  const taskId = await ctx.client.submitDescribe(base64)
  const task = await ctx.client.waitForTask(taskId)

  const prompts = (task.promptEn || '')
    .split(/\n\n/)
    .map((line) => line.replace(/^[1-4]️⃣\s*/u, '').trim())
    .filter(Boolean)

  return { prompts, publicUrl: task.imageUrl, elapsedMs: Date.now() - startedAt }
}
