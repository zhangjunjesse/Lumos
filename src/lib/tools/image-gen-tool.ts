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
const MAX_TRACKED_SESSIONS = 256;
const QUOTA_REQUEST_TIMEOUT_MS = 8_000;
const QUOTA_MAX_ATTEMPTS = 2;
const QUOTA_RETRY_BACKOFF_MS = 600;

function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined;
  const causeMsg = cause instanceof Error ? cause.message : undefined;
  const parts = [`${err.name}: ${err.message}`];
  if (causeCode) parts.push(`cause.code=${causeCode}`);
  if (causeMsg && causeMsg !== err.message) parts.push(`cause=${causeMsg}`);
  return parts.join(' | ');
}

/** Module-level counter keyed by sessionId, persists across requests within the same process. */
const sessionGenerationCounts = new Map<string, number>();

function bumpSessionCount(key: string): number {
  const current = sessionGenerationCounts.get(key) ?? 0;
  const next = current + 1;
  // Bound memory: evict oldest entry when over cap. Map iteration is insertion order.
  if (!sessionGenerationCounts.has(key) && sessionGenerationCounts.size >= MAX_TRACKED_SESSIONS) {
    const oldest = sessionGenerationCounts.keys().next().value;
    if (oldest !== undefined) sessionGenerationCounts.delete(oldest);
  }
  sessionGenerationCounts.set(key, next);
  return next;
}

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
 * Atomically consume image quota via lumos-web. Returns detailed error text
 * (including remote HTTP status and body snippet) on failure so callers and
 * the UI can surface the real cause instead of a generic fallback.
 */
async function consumeRemoteQuota(
  userId: string,
  count: number,
  model: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = getWebSessionToken(userId);
  if (!token) {
    return {
      ok: false,
      error: `未登录 Lumos 云账户，无法使用图片生成功能 (userId=${userId}，lumos_users.web_session_token 为空)`,
    };
  }

  const url = `${getWebBase()}/api/quota/image/consume`;
  const body = JSON.stringify({ count, model, action: 'consume' });
  let res: Response | undefined;
  const attemptErrors: string[] = [];
  for (let attempt = 1; attempt <= QUOTA_MAX_ATTEMPTS; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: AbortSignal.timeout(QUOTA_REQUEST_TIMEOUT_MS),
      });
      break;
    } catch (err) {
      const detail = describeFetchError(err);
      attemptErrors.push(`#${attempt} ${detail}`);
      console.warn(`[image-gen-tool] quota fetch attempt ${attempt}/${QUOTA_MAX_ATTEMPTS} failed: ${detail}`);
      if (attempt < QUOTA_MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, QUOTA_RETRY_BACKOFF_MS * attempt));
      }
    }
  }
  if (!res) {
    return {
      ok: false,
      error: `Lumos 云配额接口不可达 (${url})，${QUOTA_MAX_ATTEMPTS} 次尝试均失败：${attemptErrors.join(' ; ')}`,
    };
  }

  const rawText = await res.text().catch(() => '');
  let data: Record<string, unknown> = {};
  try { data = rawText ? JSON.parse(rawText) : {}; } catch { /* non-JSON body */ }

  if (res.status === 401) {
    const detail = typeof data.error === 'string' ? data.error : (rawText.slice(0, 200) || '无返回');
    return { ok: false, error: `Lumos 云会话已过期，请重新登录 (HTTP 401: ${detail})` };
  }
  if (res.status === 402) {
    const detail = typeof data.error === 'string' ? data.error : '本月图片额度已用完';
    return { ok: false, error: `Lumos 云图片额度已用完 (HTTP 402: ${detail})` };
  }
  if (!res.ok || !data.success) {
    const serverMsg = typeof data.error === 'string' ? data.error : rawText.slice(0, 300);
    return {
      ok: false,
      error: `Lumos 云配额检查失败 (HTTP ${res.status} ${res.statusText || ''}): ${serverMsg || '<空>'}`,
    };
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
      signal: AbortSignal.timeout(QUOTA_REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn('[image-gen-tool] Failed to refund quota:', e);
  }
}

const inputSchema = {
  prompt: z.string().describe(
    'Detailed English description of the image to generate. '
    + 'For editing tasks, describe only the requested changes. '
    + 'IMPORTANT: Do NOT embed absolute file paths (e.g. `/Users/.../foo.jpg`) in this field. '
    + 'If the task references local image files, pass every path via `reference_image_paths` '
    + 'and describe them here by position only (e.g. "Image 1", "Image 2").',
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
    .describe(
      'Local file paths of reference images (absolute paths, .jpg/.png/.webp/.gif/.bmp). '
      + 'Use for editing, style transfer, multi-reference composition, or any time the task '
      + 'refers to specific local images. '
      + 'REQUIRED whenever the task mentions absolute image paths — the paths go HERE, not in `prompt`.',
    ),
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
    .describe('Enable thinking mode for better prompt understanding and creative quality. Defaults to true. (DashScope only)'),
  negative_prompt: z.string()
    .optional()
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
  })).optional()
    .describe('Gemini safety threshold overrides. Use sparingly — most defaults are sensible.'),
};

type ImageGenArgs = {
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

/**
 * Detect absolute local image file paths embedded in the prompt text.
 *
 * Catches the common agent mistake of copying reference-image paths into the
 * natural-language `prompt` field instead of populating `reference_image_paths`.
 * Only flags paths that (a) look absolute, (b) have a known image extension,
 * (c) don't contain newlines or shell metachars that would indicate prose.
 */
const PROMPT_EMBEDDED_IMAGE_PATH_RE =
  /(?:^|[\s([{"'`,])((?:\/|[a-zA-Z]:[\\/])[^\s()[\]{}"'`,<>]+\.(?:jpg|jpeg|png|webp|gif|bmp|heic|heif|avif))(?=$|[\s)\]}"'`,.;:!?])/gi;

function findEmbeddedImagePaths(prompt: string): string[] {
  if (!prompt) return [];
  const found = new Set<string>();
  for (const m of prompt.matchAll(PROMPT_EMBEDDED_IMAGE_PATH_RE)) {
    found.add(m[1]);
  }
  return [...found];
}

async function runGeneration(args: ImageGenArgs, sessionId: string | undefined, count: number): Promise<CallToolResult> {
  const result = await generateImages({
    prompt: args.prompt,
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
    images: result.images.map(img => ({
      path: img.localPath,
      url: `/api/media/serve?path=${encodeURIComponent(img.localPath)}`,
      mime_type: img.mimeType,
    })),
    elapsed_ms: result.elapsedMs,
    generation_count: count,
    generation_limit: MAX_GENERATIONS_PER_SESSION,
  });
}

export function createImageGenTool(sessionId?: string, userId?: string) {
  const key = sessionId ?? '';
  const placeholderModel = 'pending';

  return tool(
    IMAGE_GEN_TOOL_NAME,
    'Generate images using AI. Call this tool when the user asks to '
    + 'generate, draw, create, edit, restyle, or transform images.',
    inputSchema,
    async (args): Promise<CallToolResult> => {
      // Fail-loud guard: absolute image paths must NEVER appear in `prompt`
      // text, regardless of whether `reference_image_paths` is populated.
      // This catches both:
      //   (a) the silent-hallucination failure (agent inlines all paths into
      //       prompt and sends zero refs to the provider), and
      //   (b) the half-right failure (agent populates refs but also copies
      //       some paths into prompt, which the provider ignores).
      // Merges paths from prompt with already-passed refs so the agent gets
      // a single, correct suggested payload. Runs BEFORE quota consumption
      // so a malformed call doesn't burn the user's quota.
      const embedded = findEmbeddedImagePaths(args.prompt);
      if (embedded.length > 0) {
        const existingRefs = args.reference_image_paths ?? [];
        const merged = [...new Set([...existingRefs, ...embedded])];
        return textResult({
          success: false,
          error:
            `Detected ${embedded.length} absolute image path(s) embedded in the prompt text. `
            + `Absolute paths belong in reference_image_paths, never in prompt. `
            + `Retry this call with reference_image_paths=${JSON.stringify(merged)} `
            + `and rewrite the prompt so it refers to them positionally (Image 1, Image 2, …) `
            + `with NO absolute paths in the prompt string.`,
          error_source: 'image_generation_input_shape',
          detected_paths: embedded,
          suggested_reference_image_paths: merged,
          hint: '把 detected_paths 里的所有路径合并进 reference_image_paths（见 suggested_reference_image_paths），并把 prompt 里的绝对路径改成"Image 1/Image 2"这类位置引用后重新调用。',
        }, true);
      }

      const count = bumpSessionCount(key);
      if (count > MAX_GENERATIONS_PER_SESSION) {
        return textResult({
          success: false,
          error: `本次对话已生成 ${MAX_GENERATIONS_PER_SESSION} 张图片,已达上限。`
            + '请开启新对话继续生成,或让用户确认后继续。',
        }, true);
      }

      const imageCount = args.count ?? 1;
      let quotaConsumed = false;
      if (userId) {
        const check = await consumeRemoteQuota(userId, imageCount, placeholderModel);
        if (!check.ok) return textResult({ success: false, error: check.error }, true);
        quotaConsumed = true;
      }

      try {
        return await runGeneration(args, sessionId, count);
      } catch (error) {
        if (userId && quotaConsumed) {
          await refundRemoteQuota(userId, imageCount, placeholderModel);
        }
        const detail = formatGenerationError(error);
        console.error('[image-gen-tool] generation failed:', error);
        return textResult({
          success: false,
          error: detail,
          error_source: 'image_generation',
          hint: '请向用户原样展示上面的 error 字段（包含具体服务商和错误原因），不要改写为"暂时有问题"等模糊说法。',
        }, true);
      }
    },
  );
}
