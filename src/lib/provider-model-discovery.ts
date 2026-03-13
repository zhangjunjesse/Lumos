import type { ApiProvider, ProviderModelOption } from '@/types';
import { DEFAULT_PROVIDER_MODEL_OPTIONS } from '@/lib/model-metadata';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const REQUEST_TIMEOUT_MS = 8000;

const PROBE_MODEL_CANDIDATES: ProviderModelOption[] = [
  ...DEFAULT_PROVIDER_MODEL_OPTIONS,
  { value: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-3-7-sonnet-20250219', label: 'Claude Sonnet 3.7' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude Sonnet 3.5' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude Haiku 3.5' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
];

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseProviderExtraEnv(raw: string | undefined): Record<string, string> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function normalizeProviderBaseUrl(baseUrl?: string): string {
  return (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

export function resolveProviderApiKey(
  provider?: Pick<ApiProvider, 'api_key' | 'extra_env'> | null,
  overrideApiKey?: string,
): string {
  const candidate = (overrideApiKey || '').trim();
  if (candidate && !candidate.startsWith('***')) {
    return candidate;
  }

  const extraEnv = parseProviderExtraEnv(provider?.extra_env);
  return (
    provider?.api_key?.trim()
    || extraEnv.ANTHROPIC_API_KEY?.trim()
    || extraEnv.ANTHROPIC_AUTH_TOKEN?.trim()
    || ''
  );
}

export function resolveProviderBaseUrl(
  provider?: Pick<ApiProvider, 'base_url' | 'extra_env'> | null,
  overrideBaseUrl?: string,
): string {
  const candidate = (overrideBaseUrl || '').trim();
  if (candidate) {
    return normalizeProviderBaseUrl(candidate);
  }

  const extraEnv = parseProviderExtraEnv(provider?.extra_env);
  return normalizeProviderBaseUrl(extraEnv.ANTHROPIC_BASE_URL || provider?.base_url || DEFAULT_BASE_URL);
}

export function resolveModelsUrl(baseUrl: string): string {
  const normalized = normalizeProviderBaseUrl(baseUrl);
  if (normalized.endsWith('/v1/models')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/models`;
  return `${normalized}/v1/models`;
}

export function resolveMessagesUrl(baseUrl: string): string {
  const normalized = normalizeProviderBaseUrl(baseUrl);
  if (normalized.endsWith('/v1/messages')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

export function buildProviderAuthHeaders(params: {
  apiKey: string;
  baseUrl: string;
  providerType?: string;
}): Record<string, string> {
  const normalizedBaseUrl = normalizeProviderBaseUrl(params.baseUrl).toLowerCase();
  const useBearer = params.providerType === 'openrouter' || normalizedBaseUrl.includes('openrouter.ai');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  if (useBearer) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  } else {
    headers['x-api-key'] = params.apiKey;
  }

  return headers;
}

export async function parseProviderError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    const record = toRecord(payload);
    if (!record) return `HTTP ${response.status}`;

    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }

    const error = toRecord(record.error);
    if (error && typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }

    return `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function normalizeModelOption(entry: unknown): ProviderModelOption | null {
  const record = toRecord(entry);
  if (!record) return null;

  const rawId = typeof record.id === 'string'
    ? record.id
    : typeof record.name === 'string'
      ? record.name
      : '';
  const value = rawId.trim();
  if (!value) return null;

  const rawLabel = typeof record.display_name === 'string'
    ? record.display_name
    : typeof record.label === 'string'
      ? record.label
      : typeof record.name === 'string'
        ? record.name
        : '';
  const label = rawLabel.trim() || value;

  return { value, label };
}

export function parseProviderModelsResponse(payload: unknown): ProviderModelOption[] {
  const record = toRecord(payload);
  const source = Array.isArray(record?.data)
    ? record.data
    : Array.isArray(payload)
      ? payload
      : [];

  const seen = new Set<string>();
  const result: ProviderModelOption[] = [];

  for (const entry of source) {
    const model = normalizeModelOption(entry);
    if (!model) continue;
    if (seen.has(model.value)) continue;
    seen.add(model.value);
    result.push(model);
  }

  return result;
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isUnavailableModelError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('model') &&
    (
      text.includes('not found') ||
      text.includes('not available') ||
      text.includes('unsupported') ||
      text.includes('unknown') ||
      text.includes('invalid') ||
      text.includes('does not exist')
    )
  ) || (
    message.includes('模型') &&
    (
      message.includes('未找到') ||
      message.includes('不可用') ||
      message.includes('未开放')
    )
  );
}

function isAutoDetectionUnsupportedError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    message.includes('暂不支持') ||
    message.includes('不支持自动探测') ||
    text.includes('unsupported') ||
    text.includes('not supported')
  );
}

async function probeProviderModels(params: {
  apiKey: string;
  baseUrl: string;
  providerType: string;
}): Promise<ProviderModelOption[]> {
  const headers = buildProviderAuthHeaders(params);
  const url = resolveMessagesUrl(params.baseUrl);
  const detected: ProviderModelOption[] = [];
  let lastHardError = '';

  for (const candidate of PROBE_MODEL_CANDIDATES) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({
          model: candidate.value,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });

      if (response.ok) {
        detected.push(candidate);
        continue;
      }

      const errorMessage = await parseProviderError(response);
      if (response.status === 400 && isUnavailableModelError(errorMessage)) {
        continue;
      }

      if (response.status === 404 && isUnavailableModelError(errorMessage)) {
        continue;
      }

      lastHardError = errorMessage || `HTTP ${response.status}`;
    } catch (error) {
      lastHardError = error instanceof Error ? error.message : String(error);
    }
  }

  if (detected.length > 0) {
    return detected;
  }

  if (isAutoDetectionUnsupportedError(lastHardError)) {
    throw new Error('当前服务不支持自动探测模型，请在模型列表中手动填写可用模型');
  }

  throw new Error(lastHardError || '当前服务不支持 /v1/models，且消息接口模型探测也未成功');
}

export async function detectProviderModels(params: {
  provider?: Pick<ApiProvider, 'provider_type' | 'base_url' | 'api_key' | 'extra_env'> | null;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
}): Promise<{ models: ProviderModelOption[]; baseUrl: string }> {
  const apiKey = resolveProviderApiKey(params.provider, params.apiKey);
  if (!apiKey) {
    throw new Error('当前配置缺少 API Key，无法探测模型');
  }

  const baseUrl = resolveProviderBaseUrl(params.provider, params.baseUrl);
  const providerType = params.providerType || params.provider?.provider_type || 'anthropic';
  try {
    const response = await fetchWithTimeout(`${resolveModelsUrl(baseUrl)}?limit=1000`, {
      method: 'GET',
      headers: buildProviderAuthHeaders({ apiKey, baseUrl, providerType }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorMessage = await parseProviderError(response);
      if (response.status !== 403 && response.status !== 404 && response.status !== 405) {
        throw new Error(errorMessage);
      }

      const models = await probeProviderModels({ apiKey, baseUrl, providerType });
      return { models, baseUrl };
    }

    const payload = await response.json();
    const models = parseProviderModelsResponse(payload);
    if (models.length === 0) {
      throw new Error('接口已返回成功，但没有解析到任何模型');
    }

    return { models, baseUrl };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('模型探测超时，请检查网络、URL 或服务商兼容性');
    }

    if (error instanceof Error && error.message.includes('/v1/models')) {
      const models = await probeProviderModels({ apiKey, baseUrl, providerType });
      return { models, baseUrl };
    }

    if (error instanceof Error && (
      error.message.includes('403') ||
      error.message.includes('404') ||
      error.message.includes('405') ||
      error.message.includes('forbidden') ||
      error.message.includes('not found') ||
      error.message.includes('method not allowed')
    )) {
      const models = await probeProviderModels({ apiKey, baseUrl, providerType });
      return { models, baseUrl };
    }

    throw error;
  }
}
