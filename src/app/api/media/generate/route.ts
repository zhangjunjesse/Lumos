import { NextRequest } from 'next/server';
import { generateImages, ImageGenError } from '@/lib/image';
import { generateVideo, VideoGenError, type VideoMode } from '@/lib/video';

interface GenerateRequest {
  prompt: string;
  type?: 'image' | 'video';
  mediaType?: 'image' | 'video';
  model?: string;
  mode?: VideoMode;
  aspectRatio?: string;
  imageSize?: string;
  resolution?: string;
  duration?: number;
  count?: number;
  providerOptions?: Record<string, unknown>;
  referenceImages?: { mimeType: string; data: string }[];
  referenceImagePaths?: string[];
  referenceImageUrls?: string[];
  referenceVideoPaths?: string[];
  referenceVideoUrls?: string[];
  sessionId?: string;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();

    if (!body.prompt) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: prompt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const mediaType = body.type || body.mediaType || 'image';
    if (mediaType === 'video') {
      const result = await generateVideo({
        prompt: body.prompt,
        model: body.model,
        mode: body.mode,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution || body.imageSize,
        duration: body.duration,
        providerOptions: body.providerOptions,
        referenceImages: body.referenceImages,
        referenceImagePaths: body.referenceImagePaths,
        referenceImageUrls: body.referenceImageUrls,
        referenceVideoPaths: body.referenceVideoPaths,
        referenceVideoUrls: body.referenceVideoUrls,
        sessionId: body.sessionId,
      });

      return new Response(
        JSON.stringify({
          id: result.mediaGenerationId,
          text: '',
          type: 'video',
          videos: result.videos,
          model: result.model,
          aspectRatio: body.aspectRatio || '16:9',
          resolution: body.resolution || body.imageSize || '720P',
          duration: body.duration || 6,
          elapsedMs: result.elapsedMs,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await generateImages({
      prompt: body.prompt,
      model: body.model,
      aspectRatio: body.aspectRatio,
      imageSize: body.imageSize,
      n: body.count,
      providerOptions: body.providerOptions,
      referenceImages: body.referenceImages,
      referenceImagePaths: body.referenceImagePaths,
      sessionId: body.sessionId,
    });

    return new Response(
      JSON.stringify({
        id: result.mediaGenerationId,
        text: '',
        images: result.images,
        model: result.model,
        imageSize: body.imageSize || '1K',
        elapsedMs: result.elapsedMs,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[media/generate] Failed:', error);

    if (error instanceof ImageGenError && error.code === 'content_policy') {
      return new Response(
        JSON.stringify({ error: 'No images were generated. Try a different prompt.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (error instanceof VideoGenError) {
      const status = error.code === 'content_policy'
        ? 422
        : error.code === 'invalid_params'
          ? 400
          : error.code === 'rate_limit'
            ? 429
            : error.code === 'timeout'
              ? 504
              : error.code === 'provider_unavailable'
                ? 503
                : 500;
      return new Response(
        JSON.stringify({ error: error.message, code: error.code, retryable: error.retryable }),
        { status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to generate media';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
