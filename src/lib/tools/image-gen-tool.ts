import crypto from 'node:crypto';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { generateImages } from '@/lib/image';
import { coerceStringArray, coerceJsonArray } from './image-gen-arg-coerce';
import { findUnreferencedPromptPaths } from './image-gen-path-guard';
import {
  consumeRemoteQuota,
  refundRemoteQuota,
  resolveBillingTarget,
} from './image-gen-billing';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const IMAGE_GEN_TOOL_NAME = 'generate_image';

const inputSchema = {
  prompt: z.string().describe(
    'Detailed English description of the image to generate. '
    + 'For editing tasks, describe only the requested changes. '
    + 'IMPORTANT: Do NOT embed absolute file paths (e.g. `/Users/.../foo.jpg`) in this field. '
    + 'If the task references local image files, pass every path via `reference_image_paths` '
    + 'and describe them here by position only (e.g. "Image 1", "Image 2").',
  ),
  aspect_ratio: z.enum(['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4']).optional()
    .describe('Aspect ratio. Defaults to 1:1.'),
  image_size: z.enum(['1K', '2K', '4K']).optional()
    .describe('Resolution. 1K=1024px, 2K=2048px, 4K=4096px (pro model only). Defaults to 1K.'),
  count: z.number().int().min(1).max(4).optional()
    .describe('Number of images to generate (1-4). Defaults to 1. Use with enable_sequential for consistent multi-image sets.'),
  reference_image_paths: z.preprocess(coerceStringArray, z.array(z.string()).optional())
    .describe(
      'Local file paths of reference images (absolute paths, .jpg/.png/.webp/.gif/.bmp). '
      + 'Pass as a JSON array of strings. '
      + 'Use for editing, style transfer, multi-reference composition, or any time the task '
      + 'refers to specific local images. '
      + 'REQUIRED whenever the task mentions absolute image paths — the paths go HERE, not in `prompt`.',
    ),
  enable_sequential: z.boolean().optional()
    .describe('Enable sequential group mode for character/style-consistent multi-image generation. Set count>1 when using this.'),
  color_palette: z.string().optional()
    .describe("Hex color palette to control image colors, e.g. '#FF5733,#33FF57,#3357FF'."),
  region_edit_bbox: z.preprocess(coerceJsonArray, z.array(z.array(z.number())).optional())
    .describe('Bounding boxes for region editing: [[x1,y1,x2,y2], ...]. Only modify specified regions of the reference image.'),
  thinking_mode: z.boolean().optional()
    .describe('Enable thinking mode for better prompt understanding and creative quality. Defaults to true. (DashScope only)'),
  negative_prompt: z.string().optional()
    .describe('Describe what to EXCLUDE from the image, e.g. "no text, no watermark, no blur". (Gemini only — synthesized into prompt)'),
  safety_settings: z.array(z.object({
    category: z.enum([
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_CIVIC_INTEGRITY',
    ]),
    threshold: z.enum([
      'BLOCK_LOW_AND_ABOVE', 'BLOCK_MEDIUM_AND_ABOVE',
      'BLOCK_ONLY_HIGH', 'BLOCK_NONE', 'OFF',
    ]),
  })).optional().describe('Gemini safety threshold overrides. Use sparingly — most defaults are sensible.'),
};

export type ImageGenArgs = {
  prompt: string;
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '3:2' | '2:3' | '4:3' | '3:4';
  image_size?: '1K' | '2K' | '4K';
  count?: number;
  reference_image_paths?: string[];
  enable_sequential?: boolean;
  color_palette?: string;
  region_edit_bbox?: number[][];
  thinking_mode?: boolean;
  negative_prompt?: string;
  safety_settings?: Array<{ category: string; threshold: string }>;
};

function formatGenerationError(error: unknown): string {
  if (error instanceof Error) {
    const parts: string[] = [];
    const code = (error as { code?: string }).code;
    if (code) parts.push(`[${code}]`);
    parts.push(error.name === 'Error' ? error.message : `${error.name}: ${error.message}`);
    const cause = (error as { cause?: unknown }).cause;
    if (cause) {
      const causeMsg = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      parts.push(`(cause: ${causeMsg})`);
    }
    return parts.join(' ');
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

function textResult(payload: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

function buildProviderOptions(args: ImageGenArgs): Record<string, unknown> | undefined {
  const opts: Record<string, unknown> = {};
  if (args.enable_sequential) opts.enable_sequential = true;
  if (args.color_palette) opts.color_palette = args.color_palette;
  if (args.region_edit_bbox) opts.bbox_list = args.region_edit_bbox;
  if (args.thinking_mode === false) opts.thinking_mode = false;
  if (args.negative_prompt) opts.negative_prompt = args.negative_prompt;
  if (args.safety_settings) opts.safety_settings = args.safety_settings;
  return Object.keys(opts).length > 0 ? opts : undefined;
}

// 检测 prompt 内嵌入绝对图片路径的纯函数已抽到 ./image-gen-path-guard(便于单测)。

async function runGeneration(
  args: ImageGenArgs,
  sessionId: string | undefined,
  model: string,
): Promise<CallToolResult> {
  const result = await generateImages({
    prompt: args.prompt,
    model: model || undefined,
    aspectRatio: args.aspect_ratio || '1:1',
    imageSize: args.image_size || '1K',
    n: args.count,
    referenceImagePaths: args.reference_image_paths,
    providerOptions: buildProviderOptions(args),
    sessionId,
  });

  return textResult({
    success: true,
    media_generation_id: result.mediaGenerationId,
    model: result.model,
    provider: result.providerName,
    created_at: new Date().toISOString(), // 真实生成时间(灵感库按它分组/排序,别用消息时间)
    images: result.images.map(img => ({
      path: img.localPath,
      url: `/api/media/serve?path=${encodeURIComponent(img.localPath)}`,
      mime_type: img.mimeType,
    })),
    elapsed_ms: result.elapsedMs,
    generated_image_count: result.images.length,
    // 按任务计价的服务商(如 Midjourney)一次调用固定出一批候选,收一份钱
    billing_mode: result.billingUnit === 'task' ? 'per_task' : 'per_image',
  });
}

// 完整的一次出图执行:输入防护 → 计费 → 生成 → 失败退款。抽成独立函数是为了让
// 团队出图的 HTTP 回调链路(stdio MCP → API route)与聊天的进程内 tool 共用同一实现。
export async function runImageGen(
  args: ImageGenArgs,
  sessionId: string | undefined,
  userId: string | undefined,
): Promise<CallToolResult> {
  // 只拦「prompt 里有、但没放进 reference_image_paths」的路径(那才是真漏传,provider 收不到参考图)。
  // 已在 reference_image_paths 里的重复路径放行 —— 上游 context-image 注入器会把
  // "[Context Image N: /abs/path]" 拼进 agent 文本,agent 据此正确填了 reference_image_paths
  // 却又在 prompt 里带了路径;旧逻辑一刀切拦死,导致图生图 100% 失败(#28)。
  const unreferenced = findUnreferencedPromptPaths(args.prompt, args.reference_image_paths);
  if (unreferenced.length > 0) {
    const existingRefs = args.reference_image_paths ?? [];
    const merged = [...new Set([...existingRefs, ...unreferenced])];
    return textResult({
      success: false,
      error:
        `Detected ${unreferenced.length} absolute image path(s) in the prompt text that are NOT in reference_image_paths. `
        + `Absolute paths belong in reference_image_paths, never only in prompt. `
        + `Retry this call with reference_image_paths=${JSON.stringify(merged)} `
        + `and rewrite the prompt so it refers to them positionally (Image 1, Image 2, …) `
        + `with NO absolute paths in the prompt string.`,
      error_source: 'image_generation_input_shape',
      detected_paths: unreferenced,
      suggested_reference_image_paths: merged,
      hint: '把 detected_paths 里的路径合并进 reference_image_paths（见 suggested_reference_image_paths），并把 prompt 里的绝对路径改成"Image 1/Image 2"这类位置引用后重新调用。',
    }, true);
  }

  const target = resolveBillingTarget();
  if ('error' in target) return textResult({ success: false, error: target.error }, true);
  if (!target.model) {
    return textResult({
      success: false,
      error:
        `图片服务商"${target.provider.name}"没有可用模型 (model_catalog 为空, 且 model_override:image 未设置)。`
        + `请先在管理端或本地 model_catalog 配置至少一个模型。`,
    }, true);
  }

  const imageCount = args.count ?? 1;
  const idempotencyKey = crypto.randomUUID();
  let quotaConsumed = false;

  if (userId) {
    if (!target.remoteProviderId) {
      return textResult({
        success: false,
        error:
          `图片服务商"${target.provider.name}"不是由 Lumos Cloud 登录下发的云端服务商，`
          + `无法走中心计费。请在管理端配置并重新登录，或改用自建 provider (需要自付 API 费用)。`,
      }, true);
    }
    const check = await consumeRemoteQuota({
      userId,
      providerId: target.remoteProviderId,
      model: target.model,
      count: imageCount,
      idempotencyKey,
    });
    if (!check.ok) return textResult({ success: false, error: check.error }, true);
    quotaConsumed = true;
  }

  try {
    return await runGeneration(args, sessionId, target.model);
  } catch (error) {
    if (userId && quotaConsumed) {
      await refundRemoteQuota(userId, idempotencyKey);
    }
    const detail = formatGenerationError(error);
    console.error('[image-gen-tool] generation failed:', error);
    return textResult({
      success: false,
      error: detail,
      error_source: 'image_generation',
      hint: '请向用户原样展示上面的 error 字段（包含具体服务商和错误原因），不要改写为"暂时有问题"等模糊说法。',
    });
  }
}

export function createImageGenTool(sessionId?: string, userId?: string) {
  return tool(
    IMAGE_GEN_TOOL_NAME,
    'Generate images using AI. Call this tool when the user asks to '
    + 'generate, draw, create, edit, restyle, or transform images.',
    inputSchema,
    (args): Promise<CallToolResult> => runImageGen(args, sessionId, userId),
  );
}
