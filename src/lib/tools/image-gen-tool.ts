import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { generateImages } from '@/lib/image';
import { getDb } from '@/lib/db/connection';

/** Minimal CallToolResult compatible with MCP SDK types used by the Claude Agent SDK. */
interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const IMAGE_GEN_TOOL_NAME = 'generate_image';
const MAX_GENERATIONS_PER_SESSION = 10;

/** Module-level counter keyed by sessionId, persists across requests within the same process. */
const sessionGenerationCounts = new Map<string, number>();

function getWebBase(): string {
  return process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';
}

function getWebSessionToken(userId: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT web_session_token FROM lumos_users WHERE id = ?',
  ).get(userId) as { web_session_token: string } | undefined;
  return row?.web_session_token || null;
}

/**
 * Atomically consume image quota via lumos-web. Returns quota error message
 * if exceeded, or null on success. Throws on network/auth failure.
 */
async function consumeRemoteQuota(
  userId: string,
  count: number,
  model: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = getWebSessionToken(userId);
  if (!token) {
    return { ok: false, error: '未登录 Lumos 云账户，无法使用图片生成功能' };
  }

  const res = await fetch(`${getWebBase()}/api/quota/image/consume`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ count, model, action: 'consume' }),
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    return { ok: false, error: 'Lumos 云会话已过期，请重新登录' };
  }
  if (res.status === 402) {
    return { ok: false, error: data.error || '本月图片额度已用完' };
  }
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || `配额检查失败 (HTTP ${res.status})` };
  }
  return { ok: true };
}

/**
 * Refund previously consumed quota (e.g., when generation fails).
 * Best-effort — logs errors but does not throw.
 */
async function refundRemoteQuota(
  userId: string,
  count: number,
  model: string,
): Promise<void> {
  const token = getWebSessionToken(userId);
  if (!token) return;
  try {
    await fetch(`${getWebBase()}/api/quota/image/consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ count, model, action: 'refund' }),
    });
  } catch (e) {
    console.warn('[image-gen-tool] Failed to refund quota:', e);
  }
}

const inputSchema = {
  prompt: z.string().describe(
    'Detailed English description of the image to generate. '
    + 'For editing tasks, describe only the requested changes.',
  ),
  aspect_ratio: z.enum(['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'])
    .optional()
    .describe('Aspect ratio. Defaults to 1:1.'),
  image_size: z.enum(['1K', '2K', '4K'])
    .optional()
    .describe('Resolution. 1K=1024px, 2K=2048px, 4K=4096px (pro model only). Defaults to 1K.'),
  count: z.number().int().min(1).max(4)
    .optional()
    .describe('Number of images to generate (1-4). Defaults to 1. Use with enable_sequential for consistent multi-image sets.'),
  reference_image_paths: z.array(z.string())
    .optional()
    .describe('Local file paths of reference images for editing or style transfer.'),
  enable_sequential: z.boolean()
    .optional()
    .describe('Enable sequential group mode for character/style-consistent multi-image generation. Set count>1 when using this.'),
  color_palette: z.string()
    .optional()
    .describe("Hex color palette to control image colors, e.g. '#FF5733,#33FF57,#3357FF'."),
  region_edit_bbox: z.array(z.array(z.number()))
    .optional()
    .describe('Bounding boxes for region editing: [[x1,y1,x2,y2], ...]. Only modify specified regions of the reference image.'),
  thinking_mode: z.boolean()
    .optional()
    .describe('Enable thinking mode for better prompt understanding and creative quality. Defaults to true.'),
};

export function createImageGenTool(sessionId?: string, userId?: string) {
  const key = sessionId ?? '';

  return tool(
    IMAGE_GEN_TOOL_NAME,
    'Generate images using AI. Call this tool when the user asks to '
    + 'generate, draw, create, edit, restyle, or transform images.',
    inputSchema,
    async (args): Promise<CallToolResult> => {
      const count = (sessionGenerationCounts.get(key) ?? 0) + 1;
      sessionGenerationCounts.set(key, count);

      if (count > MAX_GENERATIONS_PER_SESSION) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `本次对话已生成 ${MAX_GENERATIONS_PER_SESSION} 张图片，已达上限。`
                + '请开启新对话继续生成，或让用户确认后继续。',
            }),
          }],
          isError: true,
        };
      }

      // Reserve monthly image quota via lumos-web (atomic across devices).
      // Uses a placeholder model name — the real model is only known after
      // generation, so we refund on failure and track only the count.
      const imageCount = args.count ?? 1;
      const placeholderModel = 'pending';
      let quotaConsumed = false;

      if (userId) {
        const check = await consumeRemoteQuota(userId, imageCount, placeholderModel);
        if (!check.ok) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: false, error: check.error }),
            }],
            isError: true,
          };
        }
        quotaConsumed = true;
      }

      try {
        const providerOptions: Record<string, unknown> = {};
        if (args.enable_sequential) providerOptions.enable_sequential = true;
        if (args.color_palette) providerOptions.color_palette = args.color_palette;
        if (args.region_edit_bbox) providerOptions.bbox_list = args.region_edit_bbox;
        if (args.thinking_mode === false) providerOptions.thinking_mode = false;

        const result = await generateImages({
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio || '1:1',
          imageSize: args.image_size || '1K',
          n: args.count,
          referenceImagePaths: args.reference_image_paths,
          providerOptions: Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
          sessionId,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              media_generation_id: result.mediaGenerationId,
              model: result.model,
              provider: result.providerName,
              images: result.images.map(img => ({
                path: img.localPath,
                url: `/api/media/serve?path=${encodeURIComponent(img.localPath)}`,
                mime_type: img.mimeType,
              })),
              elapsed_ms: result.elapsedMs,
              generation_count: count,
              generation_limit: MAX_GENERATIONS_PER_SESSION,
            }),
          }],
        };
      } catch (error) {
        // Refund the reserved quota since generation failed
        if (userId && quotaConsumed) {
          await refundRemoteQuota(userId, imageCount, placeholderModel);
        }
        const message = error instanceof Error ? error.message : '图片生成失败';
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
          isError: true,
        };
      }
    },
  );
}
