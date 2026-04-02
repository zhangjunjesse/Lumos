import { generateImage, NoImageGeneratedError } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getDb, getSession, getSetting } from '@/lib/db';
import { providerSupportsCapability } from '@/lib/provider-config';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateImageVolcengine } from '@/lib/image-generator-volcengine';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
const MEDIA_DIR = path.join(dataDir, '.lumos-media');

export interface GenerateSingleImageParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  referenceImages?: { mimeType: string; data: string }[];
  referenceImagePaths?: string[];
  sessionId?: string;
  abortSignal?: AbortSignal;
}

export interface GenerateSingleImageResult {
  mediaGenerationId: string;
  images: Array<{ mimeType: string; localPath: string }>;
  elapsedMs: number;
  model: string;
  providerType: string;
  providerName: string;
}

function parseExtraEnv(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function resolveModel(
  providerType: string,
  providerEnv: Record<string, string>,
  modelOverride: string | null | undefined,
  requested?: string,
): string {
  if (requested) return requested;
  if (modelOverride) return modelOverride;
  if (providerType === 'volcengine') return 'doubao-seedream-3-0-t2i-250415';
  return providerEnv.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
}

function saveBase64Images(
  items: Array<{ base64: string; mimeType: string }>,
): Array<{ mimeType: string; localPath: string }> {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  return items.map(({ base64, mimeType }) => {
    const ext = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : '.png';
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const filePath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { mimeType, localPath: filePath };
  });
}

/**
 * Shared image generation function.
 * Supports: Gemini (via @ai-sdk/google) and Volcengine/Doubao Seedream (OpenAI-compatible REST).
 */
export async function generateSingleImage(params: GenerateSingleImageParams): Promise<GenerateSingleImageResult> {
  const startTime = Date.now();
  const db = getDb();

  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) throw new Error('未配置图片生成服务商。请先在设置中为图片生成选择一个 provider。');

  const providerEnv = parseExtraEnv(provider.extra_env);
  const providerApiKey = provider.api_key || providerEnv.GEMINI_API_KEY || '';
  const providerBaseUrl = provider.base_url || providerEnv.GEMINI_BASE_URL || undefined;

  if (!providerSupportsCapability(provider, 'image-gen')) {
    throw new Error(`图片生成服务商"${provider.name}"不支持 image-gen。`);
  }
  if (!providerApiKey) {
    throw new Error(`图片生成服务商"${provider.name}"未配置可用的 API Key。`);
  }

  const modelOverride = getSetting('model_override:image')?.trim();
  const requestedModel = resolveModel(provider.provider_type, providerEnv, modelOverride, params.model);
  const aspectRatio = (params.aspectRatio || '1:1') as `${number}:${number}`;
  const imageSize = params.imageSize || '1K';

  // Build allowed roots for reference image path validation
  const allowedRoots = [MEDIA_DIR, path.join(dataDir, '.lumos-uploads')];
  if (params.sessionId) {
    try {
      const sess = getSession(params.sessionId);
      if (sess?.working_directory) {
        allowedRoots.push(path.join(sess.working_directory, '.lumos-images'));
        allowedRoots.push(path.join(sess.working_directory, '.lumos-uploads'));
      }
    } catch { /* best effort */ }
  }

  const refImageData: string[] = [];
  if (params.referenceImagePaths?.length) {
    for (const filePath of params.referenceImagePaths) {
      const resolved = path.resolve(filePath);
      const isAllowed = allowedRoots.some(root => resolved.startsWith(path.resolve(root)));
      if (!isAllowed) {
        console.warn('[image-generator] Blocked reference_image_paths outside allowed directories:', filePath);
        continue;
      }
      if (fs.existsSync(resolved)) refImageData.push(fs.readFileSync(resolved).toString('base64'));
    }
  }
  if (params.referenceImages?.length) {
    refImageData.push(...params.referenceImages.map(img => img.data));
  }

  // Call the appropriate backend
  let savedImages: Array<{ mimeType: string; localPath: string }>;

  if (provider.provider_type === 'volcengine') {
    const volcResults = await generateImageVolcengine({
      apiKey: providerApiKey,
      baseUrl: providerBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
      model: requestedModel,
      prompt: params.prompt,
      imageSize,
      abortSignal: params.abortSignal || AbortSignal.timeout(300_000),
    });
    savedImages = saveBase64Images(volcResults);
  } else {
    // Gemini via @ai-sdk/google
    const google = createGoogleGenerativeAI({ apiKey: providerApiKey, baseURL: providerBaseUrl });
    const prompt = refImageData.length > 0 ? { text: params.prompt, images: refImageData } : params.prompt;
    const { images } = await generateImage({
      model: google.image(requestedModel),
      prompt,
      providerOptions: { google: { imageConfig: { aspectRatio, imageSize } } },
      maxRetries: 3,
      abortSignal: params.abortSignal || AbortSignal.timeout(300_000),
    });
    const base64Items = images.map(img => ({ base64: Buffer.from(img.uint8Array).toString('base64'), mimeType: img.mediaType }));
    savedImages = saveBase64Images(base64Items);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[image-generator] ${provider.provider_type} ${requestedModel} ${imageSize} completed in ${elapsed}ms`);

  // Copy to project directory if sessionId provided
  if (params.sessionId) {
    try {
      const session = getSession(params.sessionId);
      if (session?.working_directory) {
        const projectImgDir = path.join(session.working_directory, '.lumos-images');
        if (!fs.existsSync(projectImgDir)) fs.mkdirSync(projectImgDir, { recursive: true });
        for (const saved of savedImages) {
          fs.copyFileSync(saved.localPath, path.join(projectImgDir, path.basename(saved.localPath)));
        }
        console.log(`[image-generator] Copied ${savedImages.length} image(s) to ${projectImgDir}`);
      }
    } catch (copyErr) {
      console.warn('[image-generator] Failed to copy images to project directory:', copyErr);
    }
  }

  // Save reference images for gallery display
  const savedRefImages: Array<{ mimeType: string; localPath: string }> = [];
  if (refImageData.length > 0) {
    const refMimeTypes = params.referenceImages
      ? params.referenceImages.map(img => img.mimeType)
      : params.referenceImagePaths?.map(() => 'image/png') ?? [];
    const refItems = refImageData.map((base64, i) => ({ base64, mimeType: refMimeTypes[i] || 'image/png' }));
    savedRefImages.push(...saveBase64Images(refItems).map((f, i) => ({ ...f, mimeType: refItems[i].mimeType })));
  }

  // DB record
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const localPath = savedImages.length > 0 ? savedImages[0].localPath : '';
  const metadata: Record<string, unknown> = { imageCount: savedImages.length, elapsedMs: elapsed, model: requestedModel };
  if (savedRefImages.length > 0) metadata.referenceImages = savedRefImages;

  db.prepare(
    `INSERT INTO media_generations (id, type, status, provider, model, prompt, aspect_ratio, image_size, local_path, thumbnail_path, session_id, message_id, tags, metadata, error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, 'image', 'completed', provider.provider_type, requestedModel, params.prompt,
    aspectRatio, imageSize, localPath, '',
    params.sessionId || null, null,
    '[]', JSON.stringify(metadata),
    null, now, now
  );

  return { mediaGenerationId: id, images: savedImages, elapsedMs: elapsed, model: requestedModel, providerType: provider.provider_type, providerName: provider.name };
}

// Re-export for backward compatibility in error handling
export { NoImageGeneratedError };
