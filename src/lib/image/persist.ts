/**
 * Image persistence — save to disk, copy to session directory, write DB record.
 *
 * Extracted from image-generator.ts; pure side-effect helpers,
 * no generation logic, no provider awareness.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb } from '@/lib/db'
import { getSession } from '@/lib/db/sessions'
import type { GeneratedImage } from './types'

/* ── Constants ────────────────────────────────────────────── */

const dataDir =
  process.env.LUMOS_DATA_DIR ||
  process.env.CLAUDE_GUI_DATA_DIR ||
  path.join(os.homedir(), '.lumos')

export const DATA_DIR = dataDir
export const MEDIA_DIR = path.join(dataDir, '.lumos-media')

/* ── Types ────────────────────────────────────────────────── */

export interface SavedImage {
  mimeType: string
  localPath: string
}

export interface CreateMediaRecordParams {
  type: string
  status: string
  providerType: string
  model: string
  prompt: string
  aspectRatio: string
  imageSize: string
  localPath: string
  sessionId?: string | null
  metadata?: Record<string, unknown>
}

/* ── Public API ───────────────────────────────────────────── */

/** Decode base64 images and write them to MEDIA_DIR. */
export function saveBase64Images(items: GeneratedImage[]): SavedImage[] {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true })

  return items.map(({ base64, mimeType }) => {
    const ext =
      mimeType === 'image/jpeg' ? '.jpg' :
      mimeType === 'image/webp' ? '.webp' : '.png'
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`
    const filePath = path.join(MEDIA_DIR, filename)
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
    return { mimeType, localPath: filePath }
  })
}

/** Copy saved images into the session's project `.lumos-images` folder. */
export function copyToSessionDirectory(images: SavedImage[], sessionId: string): void {
  try {
    const session = getSession(sessionId)
    if (!session?.working_directory) return

    const projectImgDir = path.join(session.working_directory, '.lumos-images')
    if (!fs.existsSync(projectImgDir)) fs.mkdirSync(projectImgDir, { recursive: true })

    for (const img of images) {
      fs.copyFileSync(img.localPath, path.join(projectImgDir, path.basename(img.localPath)))
    }
    console.log(`[image/persist] Copied ${images.length} image(s) to ${projectImgDir}`)
  } catch (err) {
    console.warn('[image/persist] Failed to copy images to project directory:', err)
  }
}

/** Insert a media_generations row and return the generated id. */
export function createMediaRecord(params: CreateMediaRecordParams): string {
  const db = getDb()
  const id = crypto.randomBytes(16).toString('hex')
  const now = new Date().toISOString().replace('T', ' ').split('.')[0]

  db.prepare(
    `INSERT INTO media_generations
       (id, type, status, provider, model, prompt, aspect_ratio, image_size,
        local_path, thumbnail_path, session_id, message_id, tags, metadata, error,
        created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, params.type, params.status, params.providerType, params.model,
    params.prompt, params.aspectRatio, params.imageSize, params.localPath,
    '', params.sessionId || null, null,
    '[]', JSON.stringify(params.metadata ?? {}),
    null, now, now,
  )

  return id
}
