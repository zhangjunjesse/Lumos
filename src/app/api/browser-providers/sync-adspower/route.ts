import { NextRequest, NextResponse } from 'next/server';
import { fetchAdsPowerProfiles, normalizeAdsPowerApiBaseUrl } from '@/lib/browser-provider/adspower-api';
import {
  getBrowserProviderConfigRaw,
  previewAdsPowerBrowserProfileSync,
  syncAdsPowerBrowserProfiles,
} from '@/lib/db';
import type {
  BrowserProviderProfileSyncRequest,
  BrowserProviderProfileSyncResponse,
} from '@/types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as BrowserProviderProfileSyncRequest;
    const sourceConfig = body.source_config_id ? getBrowserProviderConfigRaw(body.source_config_id) : null;
    if (body.source_config_id && !sourceConfig) {
      return NextResponse.json({ error: '浏览器接入不存在，无法同步 AdsPower Profile' }, { status: 404 });
    }
    if (sourceConfig && sourceConfig.provider_type !== 'adspower') {
      return NextResponse.json({ error: '请选择 AdsPower 接入作为同步来源' }, { status: 400 });
    }

    const apiBaseUrl = normalizeAdsPowerApiBaseUrl(body.api_base_url || sourceConfig?.api_base_url);
    const apiKey = normalizeText(body.api_key) || sourceConfig?.api_key || '';
    const profiles = await fetchAdsPowerProfiles({
      apiBaseUrl,
      apiKey,
      pageSize: 100,
      maxProfiles: body.max_profiles || 500,
    });

    if (body.dry_run) {
      const plan = previewAdsPowerBrowserProfileSync({
        profiles,
        api_base_url: apiBaseUrl,
        ...(apiKey ? { api_key: apiKey } : {}),
        enabled: body.enabled,
      });
      return NextResponse.json<BrowserProviderProfileSyncResponse>({
        created: [],
        updated: [],
        skipped: plan
          .filter((item) => item.action === 'skip')
          .map((item) => ({ profile_id: item.profile_id, name: item.name, reason: item.reason || '跳过' })),
        unchanged: plan.filter((item) => item.action === 'unchanged').length,
        profile_count: profiles.length,
        dry_run: true,
        plan,
      });
    }

    const result = syncAdsPowerBrowserProfiles({
      profiles,
      api_base_url: apiBaseUrl,
      ...(apiKey ? { api_key: apiKey } : {}),
      enabled: body.enabled,
    });

    const payload: BrowserProviderProfileSyncResponse = {
      ...result,
      profile_count: profiles.length,
    };
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '同步 AdsPower Profile 失败' },
      { status: 400 },
    );
  }
}
