import crypto from 'node:crypto';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { generateVideo, type VideoMode } from '@/lib/video';
import { validateVideoDuration } from '@/lib/video/model-profiles';
import { coerceStringArray } from './image-gen-arg-coerce';
import {
  consumeVideoQuota,
  refundVideoQuota,
  resolveVideoBillingTarget,
} from './video-gen-billing';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const VIDEO_GEN_TOOL_NAME = 'generate_video';

const inputSchema = {
  prompt: z.string().describe(
    'Detailed English description of the target video: subject, motion, scene, camera, and style. '
    + 'Do NOT put absolute local file paths in this field; pass them via reference_image_paths or reference_video_paths.',
  ),
  model: z.string().optional()
    .describe('Optional video model id. Defaults to Settings → Providers → Video Generation model override or provider default.'),
  mode: z.enum(['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit']).optional()
    .describe('Video flow. Omit to infer from references: image refs → image-to-video, video refs → video-edit, no refs → text-to-video.'),
  aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3']).optional()
    .describe('Video aspect ratio. Defaults to provider setting or 16:9. Supported values depend on the model — an unsupported value returns an error listing the valid ones. Some models (wan2.6-flash, MiniMax-Hailuo) derive it from the reference/resolution and ignore this.'),
  resolution: z.enum(['480P', '512P', '540P', '720P', '768P', '1080P', '4K']).optional()
    .describe('Output resolution (case-insensitive). Defaults to provider setting or the model default (usually 720P). Supported tiers depend on the model — an unsupported value returns an error listing the valid ones.'),
  duration: z.coerce.number().int().min(1).max(16).optional()
    .describe('Output duration in seconds (1-16). Valid values depend on the model, e.g. wan2.6 5/10/15, sora-2 4/8/12, gemini_omni_flash 4/6/10, kling 3-15 — an unsupported value returns an error listing the valid ones.'),
  reference_image_paths: z.preprocess(coerceStringArray, z.array(z.string()).optional())
    .describe('Local reference image paths for image-to-video or reference-to-video. Pass every absolute image path here.'),
  reference_video_paths: z.preprocess(coerceStringArray, z.array(z.string()).optional())
    .describe('Local reference video paths for reference-to-video or video-edit. Pass every absolute video path here.'),
  reference_image_urls: z.preprocess(coerceStringArray, z.array(z.string()).optional())
    .describe('HTTP(S) reference image URLs.'),
  reference_video_urls: z.preprocess(coerceStringArray, z.array(z.string()).optional())
    .describe('HTTP(S) reference video URLs.'),
};

type VideoGenArgs = {
  prompt: string;
  model?: string;
  mode?: VideoMode;
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | '3:2' | '2:3';
  resolution?: '480P' | '512P' | '540P' | '720P' | '768P' | '1080P' | '4K';
  duration?: number;
  reference_image_paths?: string[];
  reference_video_paths?: string[];
  reference_image_urls?: string[];
  reference_video_urls?: string[];
};

function textResult(payload: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

function formatGenerationError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return [code ? `[${code}]` : '', `${error.name}: ${error.message}`].filter(Boolean).join(' ');
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

export function createVideoGenTool(sessionId?: string, userId?: string) {
  return tool(
    VIDEO_GEN_TOOL_NAME,
    'Generate videos using AI. Call this tool when the user asks to generate, create, animate, edit, or transform videos.',
    inputSchema,
    async (args: VideoGenArgs): Promise<CallToolResult> => {
      const target = resolveVideoBillingTarget(args.model);
      if ('error' in target) return textResult({ success: false, error: target.error }, true);

      // 计费与生成必须用同一时长/模型：这里算出的值原样传给 generateVideo,
      // 不让 generate.ts 内部的 fallback 链产生第二种答案。
      const durationSeconds = args.duration ?? target.defaultDuration;
      // 时长按模型校验要发生在扣费之前,非法时长不该产生"扣了再退"的流水。
      const durationCheck = validateVideoDuration(target.model, durationSeconds);
      if (!durationCheck.ok) {
        return textResult({ success: false, error: durationCheck.error }, true);
      }
      const idempotencyKey = crypto.randomUUID();
      let quotaConsumed = false;

      if (userId) {
        if (!target.remoteProviderId) {
          return textResult({
            success: false,
            error:
              `视频服务商"${target.provider.name}"不是由 Lumos Cloud 登录下发的云端服务商，`
              + `无法走中心计费。请在管理端配置并重新登录，或改用自建 provider (需要自付 API 费用)。`,
          }, true);
        }
        if (!target.model) {
          return textResult({
            success: false,
            error:
              `视频服务商"${target.provider.name}"没有可用模型 (model_catalog 为空, 且 model_override:video 未设置)。`
              + `请先在管理端配置至少一个模型。`,
          }, true);
        }
        const check = await consumeVideoQuota({
          userId,
          providerId: target.remoteProviderId,
          model: target.model,
          durationSeconds,
          idempotencyKey,
        });
        if (!check.ok) return textResult({ success: false, error: check.error }, true);
        quotaConsumed = true;
      }

      try {
        const result = await generateVideo({
          prompt: args.prompt,
          model: target.model || undefined,
          mode: args.mode,
          aspectRatio: args.aspect_ratio,
          resolution: args.resolution,
          duration: durationSeconds,
          referenceImagePaths: args.reference_image_paths,
          referenceVideoPaths: args.reference_video_paths,
          referenceImageUrls: args.reference_image_urls,
          referenceVideoUrls: args.reference_video_urls,
          sessionId,
        });

        return textResult({
          success: true,
          media_generation_id: result.mediaGenerationId,
          model: result.model,
          provider: result.providerName,
          created_at: new Date().toISOString(),
          videos: result.videos.map((video) => ({
            path: video.localPath,
            url: video.url,
            mime_type: video.mimeType,
          })),
          elapsed_ms: result.elapsedMs,
          duration_seconds: durationSeconds,
          billing_mode: userId ? 'per_second' : 'provider_direct',
        });
      } catch (error) {
        if (userId && quotaConsumed) {
          await refundVideoQuota(userId, idempotencyKey);
        }
        console.error('[video-gen-tool] generation failed:', error);
        return textResult({
          success: false,
          error: formatGenerationError(error),
          error_source: 'video_generation',
          hint: '请向用户原样展示 error 字段。若模型是 wan2.6-flash 且没有参考素材，请让用户提供参考图/视频，或改用支持纯文生视频的模型。',
        }, true);
      }
    },
  );
}
