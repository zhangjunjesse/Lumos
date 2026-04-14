/**
 * Fetch the user's available model catalog from the Lumos Cloud (new-api) backend.
 *
 * Used by `provisionCloudProvider` on every login so that the local "Lumos Cloud"
 * provider's `model_catalog` reflects the channel models currently configured for
 * the user's token on the new-api server.
 */

import { resolveModelsUrl, parseProviderModelsResponse } from '@/lib/provider-model-discovery';

const CLOUD_MODELS_FETCH_TIMEOUT_MS = 8000;

/**
 * Calls `<base>/v1/models?limit=1000` with `Authorization: Bearer <key>`
 * (new-api supports the OpenAI-compatible models endpoint).
 *
 * Returns an empty array on any failure — caller is responsible for falling
 * back to a default catalog or keeping the existing one. Never throws.
 */
export async function fetchCloudAvailableModels(
  baseUrl: string,
  apiKey: string,
): Promise<{ value: string; label: string }[]> {
  const url = `${resolveModelsUrl(baseUrl)}?limit=1000`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_MODELS_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[lumos-cloud] /v1/models returned HTTP ${res.status}`);
      return [];
    }

    const payload = await res.json();
    return parseProviderModelsResponse(payload);
  } catch (e) {
    console.warn('[lumos-cloud] Failed to fetch model catalog:', e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
