import type { ApiProvider } from '@/types';
import { getUpstreamChannelIdFromExtraEnv } from '@/lib/claude/provider-env';
import {
  buildProviderAuthHeaders,
  parseProviderExtraEnv,
  resolveMessagesUrl,
  resolveProviderBaseUrl,
  resolveProviderRequestApiKey,
} from '@/lib/provider-model-discovery';
import type {
  ProviderProbeAdapter,
  ProviderProbeInput,
  RawProbeResult,
} from './provider-health-types';

const REQUEST_ID_HEADERS = [
  'x-request-id',
  'request-id',
  'x-correlation-id',
  'x-oneapi-request-id',
  'x-newapi-request-id',
  'cf-ray',
];

function parseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractRequestIdFromHeaders(headers: Headers): string | undefined {
  for (const header of REQUEST_ID_HEADERS) {
    const value = headers.get(header)?.trim();
    if (value) return value;
  }
  return undefined;
}

function extractRequestIdFromBody(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['request_id', 'requestId', 'id']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const error = record.error;
  if (error && typeof error === 'object') {
    return extractRequestIdFromBody(error);
  }
  return undefined;
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { name?: unknown; code?: unknown; message?: unknown };
  return (
    record.name === 'AbortError'
    || record.code === 'ABORT_ERR'
    || (typeof record.message === 'string' && /aborted|timeout|timed out/i.test(record.message))
  );
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export class AnthropicMessagesProbeAdapter implements ProviderProbeAdapter {
  readonly name = 'anthropic-messages';

  canHandle(provider: ApiProvider): boolean {
    return provider.api_protocol === 'anthropic-messages';
  }

  async probe(input: ProviderProbeInput): Promise<RawProbeResult> {
    const startedAt = Date.now();
    const baseUrl = resolveProviderBaseUrl(input.provider);
    const apiKey = resolveProviderRequestApiKey(input.provider);
    const extraEnv = parseProviderExtraEnv(input.provider.extra_env);
    const upstreamChannelId = getUpstreamChannelIdFromExtraEnv(extraEnv);
    const headers = {
      ...buildProviderAuthHeaders({
        apiKey,
        baseUrl,
        providerType: input.provider.provider_type,
        apiProtocol: input.provider.api_protocol,
      }),
      ...(upstreamChannelId ? { 'Specific-Channel-Id': upstreamChannelId } : {}),
    };

    try {
      const response = await fetch(resolveMessagesUrl(baseUrl), {
        method: 'POST',
        headers,
        cache: 'no-store',
        signal: input.signal,
        body: JSON.stringify({
          model: input.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: '只回复 ok' }],
        }),
      });
      const bodyText = await readResponseText(response);
      const bodyJson = parseJson(bodyText);
      const requestId = extractRequestIdFromHeaders(response.headers)
        || extractRequestIdFromBody(bodyJson);

      return {
        ok: response.ok,
        httpStatus: response.status,
        latencyMs: Date.now() - startedAt,
        ...(requestId ? { requestId } : {}),
        ...(bodyText ? { bodyText: bodyText.slice(0, 8_000) } : {}),
        ...(bodyJson !== undefined ? { bodyJson } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error,
        timedOut: isAbortLikeError(error),
      };
    }
  }
}

export const PROVIDER_PROBE_ADAPTERS: ProviderProbeAdapter[] = [
  new AnthropicMessagesProbeAdapter(),
];

