import { NextRequest, NextResponse } from 'next/server';
import { testBrowserProviderConfig } from '@/lib/browser-provider/testing';
import { getBrowserProviderConfigRaw } from '@/lib/db';
import type {
  BrowserProviderConfig,
  BrowserProviderDraftTestRequest,
  BrowserProviderDraftTestResponse,
  BrowserProviderType,
} from '@/types';

const DEFAULT_ADSPOWER_API_BASE_URL = 'http://127.0.0.1:50325';
const LEGACY_ADSPOWER_API_BASE_URL = 'http://local.adspower.net:50325';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAdsPowerApiBaseUrl(value: unknown): string {
  const normalized = (normalizeText(value) || DEFAULT_ADSPOWER_API_BASE_URL).replace(/\/+$/, '');
  return normalized === LEGACY_ADSPOWER_API_BASE_URL ? DEFAULT_ADSPOWER_API_BASE_URL : normalized;
}

function isEditableProviderType(value: unknown): value is Exclude<BrowserProviderType, 'embedded'> {
  return value === 'adspower' || value === 'external-cdp';
}

function buildDraftConfig(body: BrowserProviderDraftTestRequest): BrowserProviderConfig {
  const existing = body.config_id ? getBrowserProviderConfigRaw(body.config_id) : null;
  const providerType = isEditableProviderType(body.provider_type)
    ? body.provider_type
    : existing?.provider_type;

  if (!isEditableProviderType(providerType)) {
    throw new Error('请选择浏览器接入类型');
  }

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const apiKey = normalizeText(body.api_key) || existing?.api_key || '';
  return {
    id: existing?.id || 'draft',
    provider_type: providerType,
    display_name: normalizeText(body.display_name) || existing?.display_name || (providerType === 'adspower' ? 'AdsPower' : 'External CDP'),
    enabled: 1,
    api_base_url: providerType === 'adspower'
      ? normalizeAdsPowerApiBaseUrl(body.api_base_url ?? existing?.api_base_url)
      : normalizeText(body.api_base_url ?? existing?.api_base_url),
    api_key: apiKey,
    cdp_endpoint: normalizeText(body.cdp_endpoint ?? existing?.cdp_endpoint),
    profile_id: normalizeText(body.profile_id ?? existing?.profile_id),
    profile_name: normalizeText(body.profile_name ?? existing?.profile_name),
    notes: existing?.notes || '',
    last_test_status: 'untested',
    last_test_message: '',
    last_profile_count: 0,
    last_tested_at: null,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as BrowserProviderDraftTestRequest;
    const result = await testBrowserProviderConfig(buildDraftConfig(body));
    const payload: BrowserProviderDraftTestResponse = result;
    return NextResponse.json(payload, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'failed',
        message: error instanceof Error ? error.message : '测试浏览器接入失败',
        profile_count: 0,
        profiles: [],
      } satisfies BrowserProviderDraftTestResponse,
      { status: 400 },
    );
  }
}
