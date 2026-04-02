/**
 * Volcengine (火山引擎) image generation adapter.
 * Supports Doubao Seedream models via the OpenAI-compatible /images/generations endpoint.
 * API docs: https://www.volcengine.com/docs/82379/1399508
 */

export interface VolcengineImageParams {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  imageSize?: string;
  guidanceScale?: number;
  seed?: number;
  watermark?: boolean;
  abortSignal?: AbortSignal;
}

export interface VolcengineImageResult {
  /** base64-encoded PNG/JPEG data downloaded from the returned URL */
  base64: string;
  mimeType: string;
}

const DEFAULT_GUIDANCE_SCALE = 8.0;
const DEFAULT_IMAGE_SIZE = '1024x1024';

/** Maps Lumos size tokens to Volcengine pixel sizes. */
const SIZE_MAP: Record<string, string> = {
  '1K': '1024x1024',
  '2K': '2048x2048',
  '4K': '4096x4096',
};

function resolveSize(imageSize?: string): string {
  if (!imageSize) return DEFAULT_IMAGE_SIZE;
  return SIZE_MAP[imageSize] ?? imageSize;
}

export async function generateImageVolcengine(
  params: VolcengineImageParams,
): Promise<VolcengineImageResult[]> {
  const endpoint = `${params.baseUrl.replace(/\/$/, '')}/images/generations`;
  const size = resolveSize(params.imageSize);

  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    size,
    guidance_scale: params.guidanceScale ?? DEFAULT_GUIDANCE_SCALE,
  };
  if (params.seed !== undefined && params.seed >= 0) {
    body.seed = params.seed;
  }
  if (params.watermark !== undefined) {
    body.watermark = params.watermark;
  }

  const genRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.abortSignal,
  });

  if (!genRes.ok) {
    const errText = await genRes.text().catch(() => '');
    throw new Error(`Volcengine API error ${genRes.status}: ${errText}`);
  }

  const json = await genRes.json() as { data: Array<{ url?: string; b64_json?: string }> };
  if (!json.data || json.data.length === 0) {
    throw new Error('Volcengine API returned no images');
  }

  const results: VolcengineImageResult[] = [];
  for (const item of json.data) {
    if (item.b64_json) {
      results.push({ base64: item.b64_json, mimeType: 'image/png' });
      continue;
    }
    if (item.url) {
      const imgRes = await fetch(item.url, { signal: params.abortSignal });
      if (!imgRes.ok) {
        throw new Error(`Failed to download image from Volcengine URL: ${imgRes.status}`);
      }
      const contentType = imgRes.headers.get('content-type') || 'image/png';
      const mimeType = contentType.split(';')[0].trim();
      const buf = await imgRes.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      results.push({ base64, mimeType });
      continue;
    }
    throw new Error('Volcengine API response item has neither url nor b64_json');
  }
  return results;
}
