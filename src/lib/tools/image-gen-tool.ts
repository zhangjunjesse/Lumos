import crypto from 'crypto';
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

function getMonthlyImageUsage(userId: string): number {
  const db = getDb();
  const row = db.prepare(
    `SELECT COALESCE(SUM(count), 0) AS total
     FROM lumos_image_usage
     WHERE user_id = ? AND created_at >= date('now', 'start of month')`,
  ).get(userId) as { total: number };
  return row.total;
}

function getImageQuota(userId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT image_quota_monthly FROM lumos_users WHERE id = ?',
  ).get(userId) as { image_quota_monthly: number } | undefined;
  return row?.image_quota_monthly ?? 0;
}

function recordImageUsage(userId: string, model: string, count: number): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO lumos_image_usage (id, user_id, model, count) VALUES (?, ?, ?, ?)',
  ).run(crypto.randomUUID(), userId, model, count);
}

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

      // Check monthly image quota
      const imageCount = args.count ?? 1;
      if (userId) {
        const quota = getImageQuota(userId);
        const used = getMonthlyImageUsage(userId);
        if (quota > 0 && used + imageCount > quota) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `本月图片额度已用完（已用 ${used}/${quota}）。请充值图片加油包或升级月卡。`,
              }),
            }],
            isError: true,
          };
        }
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

        // Record usage after successful generation
        if (userId) {
          recordImageUsage(userId, result.model || 'unknown', result.images.length);
        }

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
        const message = error instanceof Error ? error.message : '图片生成失败';
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
          isError: true,
        };
      }
    },
  );
}
