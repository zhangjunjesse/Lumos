import crypto from 'node:crypto';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { generateImages } from '@/lib/image';
import { resolveExplicitImageProvider } from '@/lib/image/image-provider-hint';
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
  reference_mode: z.enum(['image-prompt', 'oref', 'sref']).optional()
    .describe(
      'How reference images are used (Midjourney only; ignored by other providers). '
      + '"image-prompt" (default) = classic image prompt, URLs prefixed to the prompt, weight via reference_weight (0-3, maps to --iw); '
      + '"oref" = Omni Reference — keeps the SAME subject/character across generations, weight 0-1000 (--ow). '
      + 'IMPORTANT: --oref only works on Midjourney v7; it is REJECTED on v8+ ("--oref is not compatible with --version 8.2"). '
      + 'When using oref you MUST also put "--v 7" in the prompt (and drop any --v 8.x). '
      + '"sref" = Style Reference by image — copies STYLE only, not content, weight 0-1000 (--sw). '
      + 'Note: a numeric style code (e.g. "--sref 1234567890") needs no reference image and can go directly in the prompt.',
    ),
  reference_weight: z.number().optional()
    .describe(
      'Strength of the reference image. Range depends on reference_mode: image-prompt 0-3 (--iw), '
      + 'oref 0-1000 (--ow), sref 0-1000 (--sw). Omit to let Midjourney use its default.',
    ),
  image_provider: z.string().optional()
    .describe(
      'ONLY set this when the user EXPLICITLY names an image provider for this specific image '
      + '(e.g. "画这张用 Midjourney" / "用豆包出场景图"). Value is the provider name or type '
      + '(e.g. "Midjourney", "midjourney", "豆包"). Do NOT guess or auto-pick — if the user did not '
      + 'name a provider, omit this and the system uses the configured default. Wrong/unknown names '
      + 'are ignored (fall back to default), not errors.',
    ),
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
  /** 参考图引用方式(MJ):经典垫图 / Omni Reference / Style Reference */
  reference_mode?: 'image-prompt' | 'oref' | 'sref';
  /** 参考图权重,范围随 reference_mode 变(--iw/--ow/--sw) */
  reference_weight?: number;
  /** AI 逃生舱:用户明说的服务商名字/类型,解析成 id 后覆盖就近解析结果 */
  image_provider?: string;
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
  // MJ 参考图引用方式(#58);其它服务商忽略这两个键
  if (args.reference_mode) opts.reference_mode = args.reference_mode;
  if (args.reference_weight !== undefined) opts.reference_weight = args.reference_weight;
  return Object.keys(opts).length > 0 ? opts : undefined;
}

// 检测 prompt 内嵌入绝对图片路径的纯函数已抽到 ./image-gen-path-guard(便于单测)。

async function runGeneration(
  args: ImageGenArgs,
  sessionId: string | undefined,
  model: string,
  providerId: string | undefined,
  providerSource: 'explicit' | 'caller_binding' | 'global_default',
): Promise<CallToolResult> {
  const result = await generateImages({
    prompt: args.prompt,
    model: model || undefined,
    aspectRatio: args.aspect_ratio || '1:1',
    imageSize: args.image_size || '1K',
    n: args.count,
    providerId,
    referenceImagePaths: args.reference_image_paths,
    providerOptions: buildProviderOptions(args),
    sessionId,
  });

  return textResult({
    success: true,
    media_generation_id: result.mediaGenerationId,
    model: result.model,
    provider: result.providerName,
    // 回执诚实(#64):显式指定过服务商时,同时报告"要的"和"实际用的",
    // 两者不一致(如绑定失效降级)必须可见,不允许冒充。
    ...(args.image_provider ? { requested_provider: args.image_provider } : {}),
    // 服务商来自哪一级:explicit(本次调用指定)/ caller_binding(会话/团队/成员绑定)
    // / global_default(设置里的全局默认)。用户抱怨"切换不生效"时按这个解释路由。
    provider_source: providerSource,
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
    // 参考图上传后的公网地址(#58):可直接在后续 prompt 里拼 --oref/--sref 等用法,
    // 无需重复上传同一张图。仅 MJ 这类需要先上传的服务商会有。
    ...(result.referenceUrls?.length ? { reference_urls: result.referenceUrls } : {}),
  });
}

/**
 * 调用方就近链解析出的服务商绑定。传函数则**每次出图时现解析**(#65:
 * 传静态 id 会被闭包捕获,用户中途在界面切换服务商后,同一会话/团队轮次里
 * 的后续出图仍用旧值,切换"看起来不生效");函数形态让切换即时生效。
 */
export type ImageProviderBinding = string | (() => string | undefined) | undefined;

// 完整的一次出图执行:输入防护 → 计费 → 生成 → 失败退款。抽成独立函数是为了让
// 团队出图的 HTTP 回调链路(stdio MCP → API route)与聊天的进程内 tool 共用同一实现。
export async function runImageGen(
  args: ImageGenArgs,
  sessionId: string | undefined,
  userId: string | undefined,
  // 本次出图的服务商绑定(按调用者分流,由上层就近解析);
  // 空时走全局默认 provider_override:image,行为不变。
  imageProviderBinding?: ImageProviderBinding,
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

  // AI 逃生舱:用户明说服务商时覆盖就近解析结果(explicit > 会话/成员/团队 > 全局默认)。
  // 显式指定却匹配不到 → 硬报错并列出可用清单(issue #64):静默换成默认服务商会让
  // 用户拿着别家的图以为是指定家画的,还照常扣费,比中断出图危害大得多。
  const explicit = resolveExplicitImageProvider(args.image_provider);
  if (explicit.kind === 'not_found') {
    return textResult({
      success: false,
      error:
        `没有找到叫"${explicit.requested}"的图片服务商,本次未出图。`
        + (explicit.didYouMean ? `你是不是想用"${explicit.didYouMean}"?` : ''),
      error_source: 'image_provider_not_found',
      requested_provider: explicit.requested,
      available_providers: explicit.available,
      hint: '从 available_providers 里选一个 name 重新调用,或去掉 image_provider 参数用默认服务商。',
    }, true);
  }
  // 绑定在调用时现解析(函数形态),用户中途切换服务商即时生效
  const boundProviderId = typeof imageProviderBinding === 'function' ? imageProviderBinding() : imageProviderBinding;
  const effectiveProviderId = explicit.kind === 'ok' ? explicit.providerId : boundProviderId;
  // 回执标注服务商来源,让 AI 能向用户解释"为什么用的是它"(#65:
  // 团队会话里全局默认被团队绑定盖住,用户切了全局设置以为没生效)
  const providerSource: 'explicit' | 'caller_binding' | 'global_default' =
    explicit.kind === 'ok' ? 'explicit' : boundProviderId ? 'caller_binding' : 'global_default';

  const target = resolveBillingTarget(effectiveProviderId);
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
    return await runGeneration(args, sessionId, target.model, effectiveProviderId, providerSource);
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

export function createImageGenTool(sessionId?: string, userId?: string, imageProviderBinding?: ImageProviderBinding) {
  return tool(
    IMAGE_GEN_TOOL_NAME,
    'Generate images using AI. Call this tool when the user asks to '
    + 'generate, draw, create, edit, restyle, or transform images. '
    + 'Provider precedence: explicit image_provider param > session/team/member binding > global default. '
    + 'The result reports provider_source so you can explain which level was used.',
    inputSchema,
    (args): Promise<CallToolResult> => runImageGen(args, sessionId, userId, imageProviderBinding),
  );
}
