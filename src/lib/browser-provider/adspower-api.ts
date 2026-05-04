import type { BrowserProfileSummary } from '@/types';

interface AdsPowerApiResponse<T> {
  code?: number;
  msg?: string;
  data?: T;
}

interface AdsPowerUserListData {
  list?: Array<{
    user_id?: string;
    name?: string;
    group_name?: string;
    serial_number?: string | number;
  }>;
  total?: number | string;
}

export interface FetchAdsPowerProfilesOptions {
  apiBaseUrl: string;
  apiKey?: string;
  profileId?: string;
  pageSize?: number;
  maxProfiles?: number;
}

export const DEFAULT_ADSPOWER_API_BASE_URL = 'http://127.0.0.1:50325';
const LEGACY_ADSPOWER_API_BASE_URL = 'http://local.adspower.net:50325';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAdsPowerApiBaseUrl(value: unknown): string {
  const normalized = (normalizeText(value) || DEFAULT_ADSPOWER_API_BASE_URL).replace(/\/+$/, '');
  return normalized === LEGACY_ADSPOWER_API_BASE_URL ? DEFAULT_ADSPOWER_API_BASE_URL : normalized;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 240)}` : ''}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`返回不是有效 JSON${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
}

function normalizeProfile(raw: NonNullable<AdsPowerUserListData['list']>[number]): BrowserProfileSummary | null {
  const id = normalizeText(raw.user_id);
  if (!id) {
    return null;
  }
  const group = normalizeText(raw.group_name);
  const serialNumber = raw.serial_number !== undefined ? String(raw.serial_number).trim() : '';
  return {
    id,
    name: normalizeText(raw.name) || id,
    status: group || serialNumber,
    group,
    serial_number: serialNumber,
  };
}

export async function fetchAdsPowerProfiles(options: FetchAdsPowerProfilesOptions): Promise<BrowserProfileSummary[]> {
  const apiBaseUrl = normalizeAdsPowerApiBaseUrl(options.apiBaseUrl);
  const pageSize = Math.max(1, Math.min(options.pageSize || 100, 200));
  const maxProfiles = Math.max(1, options.maxProfiles || 500);
  const profileId = normalizeText(options.profileId);
  const headers = {
    ...(normalizeText(options.apiKey) ? { Authorization: `Bearer ${normalizeText(options.apiKey)}` } : {}),
  };
  const profiles: BrowserProfileSummary[] = [];
  const seen = new Set<string>();
  let page = 1;
  let total: number | null = null;
  const maxPages = Math.ceil(maxProfiles / pageSize) + 5;

  while (profiles.length < maxProfiles && page <= maxPages) {
    const url = new URL('/api/v1/user/list', `${apiBaseUrl}/`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));
    if (profileId) {
      url.searchParams.set('user_id', profileId);
    }

    const payload = await fetchJson<AdsPowerApiResponse<AdsPowerUserListData>>(url.toString(), { headers });
    if (payload.code !== 0) {
      throw new Error(payload.msg || `AdsPower 返回错误 code ${payload.code}`);
    }

    const rows = payload.data?.list || [];
    if (payload.data?.total !== undefined) {
      const parsedTotal = Number(payload.data.total);
      total = Number.isFinite(parsedTotal) ? parsedTotal : total;
    }

    for (const rawProfile of rows) {
      const profile = normalizeProfile(rawProfile);
      if (!profile || seen.has(profile.id)) {
        continue;
      }
      seen.add(profile.id);
      profiles.push(profile);
      if (profiles.length >= maxProfiles) {
        break;
      }
    }

    if (profileId || rows.length < pageSize || (total !== null && page * pageSize >= total)) {
      break;
    }
    page += 1;
  }

  return profiles;
}
