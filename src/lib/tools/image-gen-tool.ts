import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { generateSingleImage } from '@/lib/image-generator';

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
    .describe('Resolution. Defaults to 1K.'),
  reference_image_paths: z.array(z.string())
    .optional()
    .describe('Local file paths of reference images for editing or style transfer.'),
};

export function createImageGenTool(sessionId?: string) {
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

      try {
        const result = await generateSingleImage({
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio || '1:1',
          imageSize: args.image_size || '1K',
          referenceImagePaths: args.reference_image_paths,
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
        const message = error instanceof Error ? error.message : '图片生成失败';
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
          isError: true,
        };
      }
    },
  );
}
