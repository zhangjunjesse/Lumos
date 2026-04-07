#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TOAPIS_BASE_URL = 'https://toapis.com/v1';
const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview';
const DEFAULT_OUTPUT_DIR = '.lumos-images';
const TOAPIS_POLL_INTERVAL_MS = 3000;
const TOAPIS_POLL_TIMEOUT_MS = 120000;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

function pickNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function sanitizeFileName(input) {
  const safe = (input || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'gemini-image';
}

function extFromMime(mimeType) {
  const mime = (mimeType || '').toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/bmp') return 'bmp';
  return 'png';
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] || 'image/png';
}

function stripTrailingSlash(url) {
  return (url || '').replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGeminiBaseUrl(raw) {
  const initial = pickNonEmpty(raw, DEFAULT_GEMINI_BASE_URL);
  let url;
  try {
    url = new URL(initial);
  } catch {
    return stripTrailingSlash(initial);
  }

  let pathname = stripTrailingSlash(url.pathname);
  if (!pathname) {
    pathname = '/v1beta';
  } else if (!/\/v\d+(?:beta\d*)?$/i.test(pathname)) {
    pathname = `${pathname}/v1beta`;
  }
  url.pathname = pathname;

  return stripTrailingSlash(url.toString());
}

function normalizeToApisBaseUrl(raw) {
  const initial = pickNonEmpty(raw, DEFAULT_TOAPIS_BASE_URL);
  let url;
  try {
    url = new URL(initial);
  } catch {
    const normalized = stripTrailingSlash(initial);
    return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
  }

  let pathname = stripTrailingSlash(url.pathname);
  if (!pathname) {
    pathname = '/v1';
  } else if (!/\/v1$/i.test(pathname)) {
    pathname = `${pathname}/v1`;
  }
  url.pathname = pathname;

  return stripTrailingSlash(url.toString());
}

function resolveApiStyle(baseUrl, explicitStyle) {
  const style = pickNonEmpty(explicitStyle, process.env.GEMINI_API_STYLE).toLowerCase();
  if (style === 'toapis' || style === 'openai') return 'toapis';
  if (style === 'google' || style === 'gemini') return 'gemini';

  const raw = (baseUrl || '').toLowerCase();
  if (raw.includes('toapis.com')) return 'toapis';
  return 'gemini';
}

function sanitizeSecretText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/([?&]key=)[^&\s]+/gi, '$1***')
    .replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1***')
    .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^"',\s}]+/gi, '$1***')
    .replace(/\bsk-[a-z0-9._-]{8,}\b/gi, 'sk-***');
}

function sanitizeValue(value) {
  if (typeof value === 'string') return sanitizeSecretText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [k, v] of Object.entries(value)) {
      output[k] = sanitizeValue(v);
    }
    return output;
  }
  return value;
}

function resolveOutputDir(raw) {
  const dir = pickNonEmpty(raw, process.env.GEMINI_OUTPUT_DIR, DEFAULT_OUTPUT_DIR);
  return path.resolve(process.cwd(), dir);
}

function toolResponse(payload, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function loadSdk() {
  const sdkRoots = Array.from(new Set([
    path.resolve(__dirname, '..', '..', 'feishu-mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk'),
    path.resolve(process.cwd(), 'resources', 'feishu-mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk'),
    typeof process.resourcesPath === 'string'
      ? path.resolve(process.resourcesPath, 'feishu-mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk')
      : '',
  ].filter(Boolean)));

  const entryCandidates = [];
  for (const sdkRoot of sdkRoots) {
    // MCP SDK layout varies by version:
    // - legacy: sdk/server/index.js
    // - current: sdk/dist/esm/server/index.js
    entryCandidates.push({
      serverPath: path.join(sdkRoot, 'server', 'index.js'),
      stdioPath: path.join(sdkRoot, 'server', 'stdio.js'),
      typesPath: path.join(sdkRoot, 'types.js'),
    });
    entryCandidates.push({
      serverPath: path.join(sdkRoot, 'dist', 'esm', 'server', 'index.js'),
      stdioPath: path.join(sdkRoot, 'dist', 'esm', 'server', 'stdio.js'),
      typesPath: path.join(sdkRoot, 'dist', 'esm', 'types.js'),
    });
  }

  const checkedPaths = [];
  for (const candidate of entryCandidates) {
    const { serverPath, stdioPath, typesPath } = candidate;
    checkedPaths.push(serverPath);
    if (!fs.existsSync(serverPath) || !fs.existsSync(stdioPath) || !fs.existsSync(typesPath)) {
      continue;
    }

    try {
      const [{ Server }, { StdioServerTransport }, typesMod] = await Promise.all([
        import(pathToFileURL(serverPath).href),
        import(pathToFileURL(stdioPath).href),
        import(pathToFileURL(typesPath).href),
      ]);

      return {
        Server,
        StdioServerTransport,
        ListToolsRequestSchema: typesMod.ListToolsRequestSchema,
        CallToolRequestSchema: typesMod.CallToolRequestSchema,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown import error';
      console.error('[gemini-image-mcp] Failed to import MCP SDK candidate:', serverPath, reason);
    }
  }

  throw new Error(`MCP SDK not found. Checked candidates:\n- ${checkedPaths.join('\n- ')}`);
}

async function buildReferenceParts(referenceImages) {
  const parts = [];
  const warnings = [];

  for (const rawPath of referenceImages) {
    const trimmed = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!trimmed) continue;
    const resolvedPath = path.resolve(process.cwd(), trimmed);
    try {
      const buffer = await fsp.readFile(resolvedPath);
      parts.push({
        inlineData: {
          mimeType: mimeFromPath(resolvedPath),
          data: buffer.toString('base64'),
        },
      });
    } catch (error) {
      warnings.push(`reference image skipped: ${resolvedPath} (${error instanceof Error ? error.message : 'read failed'})`);
    }
  }

  return { parts, warnings };
}

function mimeFromUrl(rawUrl) {
  try {
    const pathname = new URL(rawUrl).pathname;
    return mimeFromPath(pathname);
  } catch {
    return 'image/png';
  }
}

function decodeDataUrlImage(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  return {
    mimeType: pickNonEmpty(match[1], 'image/png'),
    data: match[2],
  };
}

function extractGeminiPartsFromCandidates(data) {
  const images = [];
  const texts = [];

  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inlineData = part?.inlineData || part?.inline_data;
      if (inlineData && typeof inlineData.data === 'string' && inlineData.data.length > 0) {
        images.push({
          data: inlineData.data,
          mimeType: pickNonEmpty(inlineData.mimeType, inlineData.mime_type, 'image/png'),
        });
      }

      if (typeof part?.text === 'string' && part.text.trim().length > 0) {
        texts.push(part.text.trim());
      }
    }
  }

  return { images, texts };
}

function extractOpenAiLikeParts(data) {
  const images = [];
  const texts = [];
  const remoteImageUrls = [];

  const dataItems = Array.isArray(data?.data) ? data.data : [];
  for (const item of dataItems) {
    if (typeof item?.b64_json === 'string' && item.b64_json.length > 0) {
      images.push({
        data: item.b64_json,
        mimeType: pickNonEmpty(item.mime_type, item.mimeType, 'image/png'),
      });
    }
    if (typeof item?.url === 'string' && item.url.trim()) {
      remoteImageUrls.push(item.url.trim());
    }
  }

  const topImages = Array.isArray(data?.images) ? data.images : [];
  for (const item of topImages) {
    if (typeof item?.b64_json === 'string' && item.b64_json.length > 0) {
      images.push({
        data: item.b64_json,
        mimeType: pickNonEmpty(item.mime_type, item.mimeType, 'image/png'),
      });
    }
    if (typeof item?.url === 'string' && item.url.trim()) {
      remoteImageUrls.push(item.url.trim());
    }
  }

  const choices = Array.isArray(data?.choices) ? data.choices : [];
  for (const choice of choices) {
    const message = choice?.message || {};
    if (typeof message?.content === 'string' && message.content.trim()) {
      texts.push(message.content.trim());
    }

    const contentItems = Array.isArray(message?.content) ? message.content : [];
    for (const item of contentItems) {
      if (typeof item?.text === 'string' && item.text.trim()) {
        texts.push(item.text.trim());
      }

      if (typeof item?.b64_json === 'string' && item.b64_json.length > 0) {
        images.push({
          data: item.b64_json,
          mimeType: pickNonEmpty(item.mime_type, item.mimeType, 'image/png'),
        });
      }

      const inlineData = item?.inlineData || item?.inline_data;
      if (inlineData && typeof inlineData.data === 'string' && inlineData.data.length > 0) {
        images.push({
          data: inlineData.data,
          mimeType: pickNonEmpty(inlineData.mimeType, inlineData.mime_type, 'image/png'),
        });
      }

      const imageUrl = item?.image_url?.url || item?.imageUrl?.url || item?.url;
      if (typeof imageUrl === 'string' && imageUrl.trim()) {
        const decoded = decodeDataUrlImage(imageUrl);
        if (decoded) {
          images.push({
            data: decoded.data,
            mimeType: decoded.mimeType,
          });
        } else {
          remoteImageUrls.push(imageUrl.trim());
        }
      }
    }
  }

  return { images, texts, remoteImageUrls };
}

function extractGeminiParts(data) {
  const images = [];
  const texts = [];
  const remoteImageUrls = [];

  const roots = [data, data?.data, data?.result].filter(Boolean);
  for (const root of roots) {
    const gemini = extractGeminiPartsFromCandidates(root);
    images.push(...gemini.images);
    texts.push(...gemini.texts);

    const openAiLike = extractOpenAiLikeParts(root);
    images.push(...openAiLike.images);
    texts.push(...openAiLike.texts);
    remoteImageUrls.push(...openAiLike.remoteImageUrls);
  }

  return { images, texts, remoteImageUrls };
}

async function downloadImageAsBase64(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Image download failed: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    mimeType: pickNonEmpty(response.headers.get('content-type'), mimeFromUrl(imageUrl), 'image/png'),
    data: buffer.toString('base64'),
  };
}

async function downloadRemoteImages(imageUrls) {
  const images = [];
  const warnings = [];

  for (const imageUrl of imageUrls) {
    try {
      const downloaded = await downloadImageAsBase64(imageUrl);
      images.push(downloaded);
    } catch (error) {
      warnings.push(`remote image download skipped: ${imageUrl} (${error instanceof Error ? error.message : 'download failed'})`);
    }
  }

  return { images, warnings };
}

function normalizeToApisModel(model) {
  const raw = pickNonEmpty(model, DEFAULT_MODEL);
  if (!raw) return raw;

  // ToAPIs docs use "*-image-preview" naming for Gemini image models.
  // Accept user aliases and normalize to the documented model IDs.
  if (/^gemini-3\.1-flash-image$/i.test(raw)) return 'gemini-3.1-flash-image-preview';
  if (/^gemini-2\.5-flash-image$/i.test(raw)) return 'gemini-2.5-flash-image-preview';
  if (/^gemini-3-pro-image$/i.test(raw)) return 'gemini-3-pro-image-preview';

  // If caller passed a generic Gemini image id without preview suffix,
  // append "-preview" to improve compatibility with ToAPIs.
  if (/^gemini-.*-image$/i.test(raw)) return `${raw}-preview`;

  return raw;
}

function extractToApisTaskId(payload) {
  return pickNonEmpty(
    payload?.id,
    payload?.task_id,
    payload?.taskId,
    payload?.data?.id,
    payload?.data?.task_id,
    payload?.data?.taskId,
  );
}

function extractToApisStatus(payload) {
  return pickNonEmpty(payload?.status, payload?.data?.status).toLowerCase();
}

function extractToApisImageUrls(payload) {
  const urls = [];
  const roots = [payload, payload?.data, payload?.result].filter(Boolean);
  for (const root of roots) {
    if (typeof root?.url === 'string' && root.url.trim()) {
      urls.push(root.url.trim());
    }
    const items = Array.isArray(root?.data) ? root.data : [];
    for (const item of items) {
      if (typeof item?.url === 'string' && item.url.trim()) {
        urls.push(item.url.trim());
      }
    }
  }
  return Array.from(new Set(urls));
}

async function uploadReferenceImagesToToApis(referenceImages, baseUrl, apiKey) {
  const warnings = [];
  const uploadedUrls = [];

  for (const rawPath of referenceImages) {
    const trimmed = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!trimmed) continue;

    const resolvedPath = path.resolve(process.cwd(), trimmed);
    try {
      const buffer = await fsp.readFile(resolvedPath);
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mimeFromPath(resolvedPath) }), path.basename(resolvedPath));

      const response = await fetch(`${baseUrl}/uploads/images`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      });

      const rawText = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }

      if (!response.ok) {
        warnings.push(`reference image upload skipped: ${resolvedPath} (upload failed: ${response.status})`);
        continue;
      }

      const uploaded = pickNonEmpty(parsed?.data?.url, parsed?.url);
      if (!uploaded) {
        warnings.push(`reference image upload skipped: ${resolvedPath} (no uploaded URL returned)`);
        continue;
      }
      uploadedUrls.push(uploaded);
    } catch (error) {
      warnings.push(`reference image upload skipped: ${resolvedPath} (${error instanceof Error ? error.message : 'upload failed'})`);
    }
  }

  return { uploadedUrls, warnings };
}

async function saveImages(images, outputDir, prefix) {
  await fsp.mkdir(outputDir, { recursive: true });
  const stamp = Date.now();
  const base = sanitizeFileName(prefix || `gemini-${stamp}`);
  const saved = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const ext = extFromMime(image.mimeType);
    const fileName = `${base}-${i + 1}.${ext}`;
    const filePath = path.join(outputDir, fileName);
    await fsp.writeFile(filePath, Buffer.from(image.data, 'base64'));
    saved.push({
      path: filePath,
      mime_type: image.mimeType,
      preview_url: `/api/files/raw?path=${encodeURIComponent(filePath)}`,
    });
  }

  return saved;
}

async function callGeminiGenerate({
  prompt,
  referenceImages,
  model,
  baseUrl,
  apiKey,
  aspectRatio,
}) {
  const { parts: referenceParts, warnings } = await buildReferenceParts(referenceImages);
  const endpoint = `${normalizeGeminiBaseUrl(baseUrl)}/models/${encodeURIComponent(model)}:generateContent`;

  const generationConfig = {
    responseModalities: ['TEXT', 'IMAGE'],
  };

  if (typeof aspectRatio === 'string' && aspectRatio.trim()) {
    generationConfig.imageConfig = { aspectRatio: aspectRatio.trim() };
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, ...referenceParts],
      },
    ],
    generationConfig,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `Gemini API request failed: ${response.status}`,
        details: sanitizeValue(parsed || rawText.slice(0, 2000)),
        warnings,
      };
    }

    if (!parsed) {
      return {
        ok: false,
        error: 'Gemini API returned non-JSON response.',
        details: {
          endpoint,
          status: response.status,
          body_preview: sanitizeSecretText(rawText.slice(0, 1000)),
        },
        warnings,
      };
    }

    const extracted = extractGeminiParts(parsed);
    const downloadedRemote = extracted.remoteImageUrls.length > 0
      ? await downloadRemoteImages(extracted.remoteImageUrls)
      : { images: [], warnings: [] };
    return {
      ok: true,
      model,
      images: [...extracted.images, ...downloadedRemote.images],
      texts: extracted.texts,
      warnings: [...warnings, ...downloadedRemote.warnings],
      api_style: 'gemini',
    };
  } catch (error) {
    return {
      ok: false,
      error: sanitizeSecretText(error instanceof Error ? error.message : 'Gemini request failed'),
      warnings,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callToApisGenerate({
  prompt,
  referenceImages,
  model,
  baseUrl,
  apiKey,
  aspectRatio,
  resolution,
}) {
  const normalizedBaseUrl = normalizeToApisBaseUrl(baseUrl);
  const normalizedModel = normalizeToApisModel(model);
  const allWarnings = [];

  try {
    const uploaded = await uploadReferenceImagesToToApis(referenceImages, normalizedBaseUrl, apiKey);
    allWarnings.push(...uploaded.warnings);

    const body = {
      model: normalizedModel,
      prompt,
      n: 1,
      ...(typeof aspectRatio === 'string' && aspectRatio.trim() ? { size: aspectRatio.trim() } : {}),
      ...(typeof resolution === 'string' && resolution.trim() ? { resolution: resolution.trim() } : {}),
      ...(uploaded.uploadedUrls.length > 0 ? { image_urls: uploaded.uploadedUrls.map((url) => ({ url })) } : {}),
    };

    const createResponse = await fetch(`${normalizedBaseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const createRawText = await createResponse.text();
    let createParsed;
    try {
      createParsed = JSON.parse(createRawText);
    } catch {
      createParsed = null;
    }

    if (!createResponse.ok) {
      const errorCode = pickNonEmpty(
        createParsed?.error?.code,
        createParsed?.code,
      );
      const errorMessage = pickNonEmpty(
        createParsed?.error?.message,
        createParsed?.message,
      );
      return {
        ok: false,
        error: `ToAPIs create task failed: ${createResponse.status}`,
        details: sanitizeValue(createParsed || createRawText.slice(0, 2000)),
        ...(errorCode === 'model_not_found'
          ? {
              hint: 'Current ToAPIs group does not provide this model. Try GEMINI_MODEL=gemini-3.1-flash-image-preview or switch to a group/channel that has this model.',
              provider_message: sanitizeSecretText(errorMessage),
            }
          : {}),
        warnings: allWarnings,
      };
    }

    const taskId = extractToApisTaskId(createParsed || {});
    const directUrls = extractToApisImageUrls(createParsed || {});
    if (!taskId && directUrls.length === 0) {
      return {
        ok: false,
        error: 'ToAPIs did not return task id or image URLs.',
        details: sanitizeValue(createParsed || {}),
        warnings: allWarnings,
      };
    }

    let finalPayload = createParsed || {};
    let status = extractToApisStatus(finalPayload) || 'queued';

    if (taskId) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < TOAPIS_POLL_TIMEOUT_MS) {
        if (status === 'completed' || status === 'succeeded') break;
        if (status === 'failed' || status === 'cancelled' || status === 'error') {
          return {
            ok: false,
            error: `ToAPIs task failed (status=${status}).`,
            details: sanitizeValue(finalPayload),
            warnings: allWarnings,
          };
        }

        await sleep(TOAPIS_POLL_INTERVAL_MS);
        const statusResponse = await fetch(`${normalizedBaseUrl}/images/generations/${encodeURIComponent(taskId)}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        const statusRawText = await statusResponse.text();
        let statusParsed;
        try {
          statusParsed = JSON.parse(statusRawText);
        } catch {
          statusParsed = null;
        }

        if (!statusResponse.ok) {
          return {
            ok: false,
            error: `ToAPIs task status failed: ${statusResponse.status}`,
            details: sanitizeValue(statusParsed || statusRawText.slice(0, 2000)),
            warnings: allWarnings,
          };
        }

        finalPayload = statusParsed || {};
        status = extractToApisStatus(finalPayload) || status;
      }
    }

    const imageUrls = Array.from(new Set([
      ...directUrls,
      ...extractToApisImageUrls(finalPayload),
    ]));

    if (imageUrls.length === 0) {
      const finalStatus = extractToApisStatus(finalPayload) || status;
      if (finalStatus !== 'completed' && finalStatus !== 'succeeded') {
        return {
          ok: false,
          error: `ToAPIs task did not complete in time (status=${finalStatus || 'unknown'}).`,
          details: sanitizeValue(finalPayload),
          warnings: allWarnings,
        };
      }
      return {
        ok: false,
        error: 'ToAPIs task completed but no image URLs were returned.',
        details: sanitizeValue(finalPayload),
        warnings: allWarnings,
      };
    }

    const downloaded = await downloadRemoteImages(imageUrls);
    allWarnings.push(...downloaded.warnings);

    return {
      ok: true,
      model: normalizedModel,
      images: downloaded.images,
      texts: [],
      warnings: allWarnings,
      api_style: 'toapis',
      task_id: taskId || undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: sanitizeSecretText(error instanceof Error ? error.message : 'ToAPIs request failed'),
      warnings: allWarnings,
    };
  }
}

async function callImageGenerate({
  prompt,
  referenceImages,
  model,
  baseUrl,
  apiKey,
  aspectRatio,
  resolution,
  apiStyle,
}) {
  const style = resolveApiStyle(baseUrl, apiStyle);
  if (style === 'toapis') {
    return callToApisGenerate({
      prompt,
      referenceImages,
      model,
      baseUrl,
      apiKey,
      aspectRatio,
      resolution,
    });
  }

  return callGeminiGenerate({
    prompt,
    referenceImages,
    model,
    baseUrl,
    apiKey,
    aspectRatio,
  });
}

const TOOLS = [
  {
    name: 'generate_image',
    description: 'Generate or edit images with Gemini and save them to local files. Supports prompt-only and prompt+reference-image workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Image generation instruction. Be specific about subject, style, composition, and constraints.',
        },
        reference_images: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional local image file paths used as reference images.',
        },
        model: {
          type: 'string',
          description: 'Optional model override, defaults to GEMINI_MODEL.',
        },
        output_dir: {
          type: 'string',
          description: 'Optional output directory. Relative paths are resolved from current working directory.',
        },
        file_name_prefix: {
          type: 'string',
          description: 'Optional output file name prefix.',
        },
        aspect_ratio: {
          type: 'string',
          description: 'Optional aspect ratio, e.g. 1:1, 16:9, 9:16.',
        },
        resolution: {
          type: 'string',
          description: 'Optional output resolution for ToAPIs style endpoints, e.g. 0.5K, 1K, 2K, 4K.',
        },
        api_style: {
          type: 'string',
          description: 'Optional API style override: gemini or toapis. Default is auto detection from base URL.',
        },
      },
      required: ['prompt'],
    },
  },
];

async function main() {
  const { Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema } = await loadSdk();
  const server = new Server(
    { name: 'gemini-image-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request?.params?.name;
    const args = request?.params?.arguments || {};

    if (name !== 'generate_image') {
      return toolResponse({ ok: false, error: `Unknown tool: ${name}` }, true);
    }

    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) {
      return toolResponse({ ok: false, error: 'prompt is required' }, true);
    }

    const apiKey = pickNonEmpty(process.env.GEMINI_API_KEY);
    if (!apiKey) {
      return toolResponse({
        ok: false,
        error: 'Missing GEMINI_API_KEY. Configure it in Lumos: Settings -> Providers -> gemini-image (API Key, optional Base URL/Model). Do not use .kiro/.claude config files.',
      }, true);
    }

    const model = pickNonEmpty(
      typeof args.model === 'string' ? args.model : '',
      process.env.GEMINI_MODEL,
      DEFAULT_MODEL,
    );
    const baseUrl = pickNonEmpty(process.env.GEMINI_BASE_URL, DEFAULT_GEMINI_BASE_URL);
    const outputDir = resolveOutputDir(typeof args.output_dir === 'string' ? args.output_dir : '');
    const fileNamePrefix = typeof args.file_name_prefix === 'string' ? args.file_name_prefix : '';
    const aspectRatio = typeof args.aspect_ratio === 'string' ? args.aspect_ratio : '';
    const resolution = typeof args.resolution === 'string' ? args.resolution : '';
    const apiStyle = typeof args.api_style === 'string' ? args.api_style : '';
    const referenceImages = Array.isArray(args.reference_images)
      ? args.reference_images.filter((v) => typeof v === 'string')
      : [];

    const generation = await callImageGenerate({
      prompt,
      referenceImages,
      model,
      baseUrl,
      apiKey,
      aspectRatio,
      resolution,
      apiStyle,
    });

    if (!generation.ok) {
      return toolResponse(generation, true);
    }

    if (!generation.images || generation.images.length === 0) {
      return toolResponse({
        ok: false,
        error: 'Image API returned no image data for this request.',
        api_style: generation.api_style || resolveApiStyle(baseUrl, apiStyle),
        model: generation.model || model,
        text: generation.texts?.join('\n\n') || '',
        warnings: generation.warnings || [],
      }, true);
    }

    const savedImages = await saveImages(generation.images, outputDir, fileNamePrefix);
    const text = Array.isArray(generation.texts) ? generation.texts.join('\n\n').trim() : '';

    return toolResponse({
      ok: true,
      model: generation.model || model,
      api_style: generation.api_style || resolveApiStyle(baseUrl, apiStyle),
      output_dir: outputDir,
      image_count: savedImages.length,
      images: savedImages,
      ...(text ? { text } : {}),
      ...(generation.task_id ? { task_id: generation.task_id } : {}),
      ...(generation.warnings?.length ? { warnings: generation.warnings } : {}),
    });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[gemini-image-mcp] Server started');
}

main().catch((error) => {
  console.error('[gemini-image-mcp] Fatal error:', error);
  process.exit(1);
});
