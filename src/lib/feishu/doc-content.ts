import { Buffer } from 'node:buffer';

const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';
const FEISHU_MAX_RETRIES = 5;
const FEISHU_MIN_REQUEST_INTERVAL_MS = 260;
const FEISHU_RATE_LIMIT_CODE = 99991400;
const DOC_CACHE_TTL_MS = 5 * 60 * 1000;

const FEISHU_REF_MARKER_PREFIX = '<!-- LUMOS_FEISHU_REF:';
const FEISHU_REF_MARKER_SUFFIX = ' -->';

interface FeishuEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

interface FeishuBlock {
  block_id: string;
  block_type: number;
  children?: string[];
  text?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading1?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading2?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading3?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading4?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading5?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading6?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading7?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading8?: { elements?: Array<{ text_run?: { content?: string } }> };
  heading9?: { elements?: Array<{ text_run?: { content?: string } }> };
  bullet?: { elements?: Array<{ text_run?: { content?: string } }> };
  ordered?: { elements?: Array<{ text_run?: { content?: string } }> };
  code?: { elements?: Array<{ text_run?: { content?: string } }> };
  quote?: { elements?: Array<{ text_run?: { content?: string } }> };
  image?: { token?: string };
}

interface CachedMarkdown {
  markdown: string;
  title?: string;
  expiresAt: number;
}

export interface FeishuDocReference {
  token: string;
  type: string;
  title: string;
  url: string;
  attachedAt?: string;
}

export interface FetchFeishuDocContextParams {
  userAccessToken: string;
  token: string;
  type: string;
  query: string;
  maxChars?: number;
}

const markdownCache = new Map<string, CachedMarkdown>();

let lastFeishuRequestAt = 0;
let requestSlot: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFeishuRequestSlot(): Promise<void> {
  let release!: () => void;
  const prev = requestSlot;
  requestSlot = new Promise<void>((resolve) => {
    release = resolve;
  });

  await prev.catch(() => undefined);
  const waitMs = Math.max(0, lastFeishuRequestAt + FEISHU_MIN_REQUEST_INTERVAL_MS - Date.now());
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastFeishuRequestAt = Date.now();
  release();
}

function looksLikeRateLimitMessage(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('request trigger frequency limit') ||
    lower.includes('frequency limit') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  );
}

function parseRateLimitResetMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const value = Number(headerValue.trim());
  if (!Number.isFinite(value) || value <= 0) return null;

  if (value > 1_000_000_000_000) {
    return Math.max(0, value - Date.now());
  }
  if (value > 1_000_000_000) {
    return Math.max(0, value * 1000 - Date.now());
  }

  return value * 1000;
}

function calcRateLimitRetryDelayMs(response: Response, attempt: number): number {
  const headerDelay = parseRateLimitResetMs(response.headers.get('x-ogw-ratelimit-reset'));
  if (headerDelay !== null && headerDelay > 0) {
    return Math.min(60_000, Math.max(300, headerDelay + 80));
  }

  const backoff = Math.min(10_000, 500 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 200);
  return backoff + jitter;
}

function calcTransientRetryDelayMs(attempt: number): number {
  const backoff = Math.min(8_000, 300 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 150);
  return backoff + jitter;
}

function extractBlockText(block: FeishuBlock | undefined): string {
  if (!block) return '';
  const textBlock =
    block.text ||
    block.heading1 ||
    block.heading2 ||
    block.heading3 ||
    block.heading4 ||
    block.heading5 ||
    block.heading6 ||
    block.heading7 ||
    block.heading8 ||
    block.heading9 ||
    block.bullet ||
    block.ordered ||
    block.code ||
    block.quote;
  if (!textBlock?.elements) return '';
  return textBlock.elements.map((el) => el.text_run?.content || '').join('');
}

function buildMarkdownContent(blocks: FeishuBlock[]): string {
  const parts: string[] = [];
  let orderedIndex = 1;
  let lastBlockType = 0;

  for (const block of blocks) {
    const bt = block.block_type;
    const text = extractBlockText(block);

    if (bt !== 13 && lastBlockType === 13) {
      orderedIndex = 1;
    }

    if (bt >= 3 && bt <= 11 && text) {
      parts.push(`${'#'.repeat(bt - 2)} ${text}`, '');
    } else if (bt === 2 && text) {
      parts.push(text, '');
    } else if (bt === 12 && text) {
      parts.push(`- ${text}`);
    } else if (bt === 13 && text) {
      parts.push(`${orderedIndex}. ${text}`);
      orderedIndex += 1;
    } else if (bt === 14 && text) {
      parts.push('```', text, '```', '');
    } else if (bt === 15 && text) {
      parts.push(`> ${text}`, '');
    } else if (bt === 27 && block.image?.token) {
      parts.push(`[Image: ${block.image.token}]`, '');
    } else if (bt === 22) {
      parts.push('---', '');
    }

    lastBlockType = bt;
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function feishuFetch<T = unknown>(
  userAccessToken: string,
  apiPath: string,
  init?: RequestInit,
): Promise<T> {
  for (let attempt = 0; attempt <= FEISHU_MAX_RETRIES; attempt++) {
    await waitForFeishuRequestSlot();

    let response: Response;
    try {
      response = await fetch(`${FEISHU_BASE_URL}${apiPath}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });
    } catch (error) {
      if (attempt < FEISHU_MAX_RETRIES) {
        await sleep(calcTransientRetryDelayMs(attempt));
        continue;
      }
      throw error;
    }

    let data: FeishuEnvelope<T> | null = null;
    try {
      data = await response.json() as FeishuEnvelope<T>;
    } catch {
      data = null;
    }

    if (response.ok && data?.code === 0 && data.data !== undefined) {
      return data.data;
    }

    const errorCode = data?.code;
    const errorMessage = data?.msg || `Feishu API failed: ${response.status}`;
    const rateLimited =
      response.status === 429 ||
      errorCode === FEISHU_RATE_LIMIT_CODE ||
      looksLikeRateLimitMessage(errorMessage);

    if (rateLimited && attempt < FEISHU_MAX_RETRIES) {
      await sleep(calcRateLimitRetryDelayMs(response, attempt));
      continue;
    }

    const transientStatus = response.status >= 500 || response.status === 408;
    if (!rateLimited && transientStatus && attempt < FEISHU_MAX_RETRIES) {
      await sleep(calcTransientRetryDelayMs(attempt));
      continue;
    }

    const prefix = rateLimited ? 'FEISHU_RATE_LIMIT' : 'FEISHU_API_ERROR';
    throw new Error(`${prefix}: ${errorMessage}`);
  }

  throw new Error('FEISHU_API_ERROR: exhausted retries');
}

async function getAllBlocks(
  userAccessToken: string,
  documentId: string,
  parentBlockId: string,
  allBlocks: FeishuBlock[] = [],
): Promise<FeishuBlock[]> {
  let pageToken = '';
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({ page_size: '50' });
    if (pageToken) {
      params.set('page_token', pageToken);
    }

    const data = await feishuFetch<{
      items?: FeishuBlock[];
      has_more?: boolean;
      page_token?: string;
    }>(
      userAccessToken,
      `/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children?${params.toString()}`,
    );

    const items = data.items || [];
    for (const block of items) {
      allBlocks.push(block);
      if (block.children && block.children.length > 0) {
        await getAllBlocks(userAccessToken, documentId, block.block_id, allBlocks);
      }
    }

    hasMore = !!data.has_more;
    pageToken = data.page_token || '';
  }

  return allBlocks;
}

async function resolveDocumentId(
  userAccessToken: string,
  token: string,
  type: string,
): Promise<{ documentId: string; title?: string }> {
  if (type === 'wiki') {
    const data = await feishuFetch<{
      node?: { obj_token?: string; title?: string };
    }>(userAccessToken, `/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`);
    const documentId = data.node?.obj_token || token;
    return { documentId, title: data.node?.title };
  }
  return { documentId: token };
}

export async function exportFeishuDocumentMarkdown(
  userAccessToken: string,
  token: string,
  type: string,
  options?: { force?: boolean },
): Promise<{ markdown: string; title?: string }> {
  const normalizedType = (type || 'docx').trim().toLowerCase();
  if (normalizedType !== 'docx' && normalizedType !== 'wiki' && normalizedType !== 'doc') {
    return { markdown: '' };
  }

  const cacheKey = `${normalizedType}:${token}`;
  if (!options?.force) {
    const cached = markdownCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { markdown: cached.markdown, title: cached.title };
    }
  }

  const resolved = await resolveDocumentId(userAccessToken, token, normalizedType);
  const blocks = await getAllBlocks(userAccessToken, resolved.documentId, resolved.documentId);
  const markdown = buildMarkdownContent(blocks);
  const title = resolved.title;
  markdownCache.set(cacheKey, {
    markdown,
    title,
    expiresAt: Date.now() + DOC_CACHE_TTL_MS,
  });
  return { markdown, title };
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,.;:!?(){}[\]"'`~<>\\/\-|_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 12);
}

export function pickRelevantMarkdownSections(markdown: string, query: string, maxChars = 4_000): string {
  const text = markdown.trim();
  if (!text) return '';

  const sections = text.split(/\n{2,}/).map((section) => section.trim()).filter(Boolean);
  if (sections.length === 0) return text.slice(0, maxChars);

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return text.slice(0, maxChars);
  }

  const scored = sections.map((section, index) => {
    const lower = section.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (!token) continue;
      const count = lower.split(token).length - 1;
      if (count > 0) {
        score += Math.min(6, count * 2);
      }
    }
    if (section.startsWith('#')) {
      score += 1;
    }
    return { section, score, index };
  });

  const ranked = scored
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .filter((item) => item.score > 0);

  if (ranked.length === 0) {
    return text.slice(0, maxChars);
  }

  const picked: string[] = [];
  let total = 0;
  for (const item of ranked) {
    const withSepLen = item.section.length + (picked.length > 0 ? 2 : 0);
    if (total + withSepLen > maxChars) continue;
    picked.push(item.section);
    total += withSepLen;
    if (picked.length >= 8) break;
  }

  return (picked.length > 0 ? picked.join('\n\n') : ranked[0].section).slice(0, maxChars);
}

export async function fetchFeishuDocumentContext(
  params: FetchFeishuDocContextParams,
): Promise<{ title?: string; excerpt: string; totalChars: number; truncated: boolean }> {
  const result = await exportFeishuDocumentMarkdown(params.userAccessToken, params.token, params.type);
  const markdown = result.markdown || '';
  const maxChars = params.maxChars || 4_000;
  const excerpt = pickRelevantMarkdownSections(markdown, params.query, maxChars);
  return {
    title: result.title,
    excerpt,
    totalChars: markdown.length,
    truncated: excerpt.length < markdown.length,
  };
}

function encodeReferencePayload(ref: FeishuDocReference): string {
  const payload = JSON.stringify(ref);
  return Buffer.from(payload, 'utf-8').toString('base64');
}

export function buildFeishuReferenceMarker(ref: FeishuDocReference): string {
  return `${FEISHU_REF_MARKER_PREFIX}${encodeReferencePayload(ref)}${FEISHU_REF_MARKER_SUFFIX}`;
}

export function buildFeishuReferenceMarkdown(ref: FeishuDocReference): string {
  return [
    `# ${ref.title}`,
    '',
    `Source: ${ref.url}`,
    `Type: ${ref.type}`,
    `Attached At: ${ref.attachedAt || new Date().toISOString()}`,
    '',
    buildFeishuReferenceMarker(ref),
    '',
    '_This is a Feishu document reference. Content will be fetched on demand for the current query._',
    '',
  ].join('\n');
}

export function parseFeishuReferenceMarkdown(content: string): FeishuDocReference | null {
  const match = content.match(/<!--\s*LUMOS_FEISHU_REF:([A-Za-z0-9+/=]+)\s*-->/);
  if (!match?.[1]) return null;

  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as Partial<FeishuDocReference>;
    if (!parsed.token || !parsed.type || !parsed.title || !parsed.url) {
      return null;
    }
    return {
      token: parsed.token,
      type: parsed.type,
      title: parsed.title,
      url: parsed.url,
      attachedAt: parsed.attachedAt,
    };
  } catch {
    return null;
  }
}

export function buildFeishuAttachFallback(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Feishu document export failed (unknown error).';
  }
  if (looksLikeRateLimitMessage(error.message) || error.message.includes('FEISHU_RATE_LIMIT')) {
    return 'Feishu document export hit rate limit. Attached as reference fallback; retry later if needed.';
  }
  return `Feishu document export failed (${error.message}). Attached as reference fallback.`;
}

