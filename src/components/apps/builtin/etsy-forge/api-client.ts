// Etsy Forge — frontend API client (typed, no JSON marshaling at call sites)

export interface BatchImage {
  id: string;
  url: string;
  theme: string;
  style: string;
  palette: string[];
  filePath?: string;
}

export interface BatchResult {
  batchId: string;
  runId: string;
  succeededCount: number;
  failedCount: number;
  quotaSpent: number;
  strategy: string;
  themesUsed: string[];
  signalsStatus: string;
  images: BatchImage[];
  failures: Array<{ theme: string; error: string }>;
}

export interface LibraryImage {
  id: string;
  source_type: 'generated' | 'remixed';
  parent_image_id?: string;
  remix_action?: string;
  theme: string;
  style: string;
  palette: string;
  url: string;
  created_at: string;
  ai_generated_tag: boolean;
}

export interface DetailResponse {
  image: LibraryImage & { url: string; file_path: string };
  derivatives: Array<{
    id: string;
    remix_action?: string;
    url: string;
    in_library: boolean;
    created_at: string;
  }>;
}

export interface RemixVariant {
  ok: boolean;
  id?: string;
  url?: string;
  error?: string;
}

export interface RemixResult {
  runId: string;
  action: string;
  succeededCount: number;
  failedCount: number;
  notImplemented?: boolean;
  notImplementedReason?: string;
  variants: RemixVariant[];
}

export interface QuotaResponse {
  ok: boolean;
  connected?: boolean;
  reason?: string;
  provider?: string;
  model?: string;
  remoteProviderId?: string | null;
  remaining_quota?: number | null;
  remaining_quota_status?: string;
  remaining_quota_reason?: string;
}

const BASE = '/api/apps/builtin/etsy-forge';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const etsyForgeApi = {
  nextBatch: (size?: number) =>
    jsonFetch<BatchResult>(`${BASE}/next-batch`, { method: 'POST', body: JSON.stringify({ size }) }),

  signal: (imageId: string, signal: 1 | -1) =>
    jsonFetch<{
      ok: boolean;
      in_library: boolean;
      profile_recomputed: boolean;
      total_signals: number;
    }>(`${BASE}/signal`, { method: 'POST', body: JSON.stringify({ image_id: imageId, signal }) }),

  library: (tab: 'all' | 'generated' | 'remixed' = 'all', offset = 0, limit = 100) =>
    jsonFetch<{ total: number; tab: string; images: LibraryImage[] }>(
      `${BASE}/library?tab=${tab}&offset=${offset}&limit=${limit}`,
    ),

  detail: (id: string) => jsonFetch<DetailResponse>(`${BASE}/library/${encodeURIComponent(id)}`),

  deleteImage: (id: string) =>
    jsonFetch<{ ok: boolean }>(`${BASE}/library/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  remix: (imageId: string, action: string) =>
    jsonFetch<RemixResult>(`${BASE}/remix`, {
      method: 'POST',
      body: JSON.stringify({ image_id: imageId, action }),
    }),

  quota: () => jsonFetch<QuotaResponse>(`${BASE}/quota`),

  exportDownload: (imageIds: string[]) =>
    jsonFetch<{
      ok: boolean;
      count: number;
      items: Array<{ id: string; url: string; filename: string }>;
      note: string;
    }>(`${BASE}/export`, {
      method: 'POST',
      body: JSON.stringify({ image_ids: imageIds, target: 'download' }),
    }),
};
