import { NextRequest, NextResponse } from 'next/server';
import {
  createBrowserProviderConfig,
  getBrowserProviderConfigRaw,
  listBrowserProviderConfigs,
} from '@/lib/db';
import { formatAdsPowerProfileNotes } from '@/lib/browser-provider/adspower-metadata';
import type {
  BrowserProviderProfileImportRequest,
  BrowserProviderProfileImportResponse,
  BrowserProfileSummary,
} from '@/types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProfiles(value: unknown): BrowserProfileSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const profiles: BrowserProfileSummary[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<BrowserProfileSummary>;
    const id = normalizeText(raw.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    profiles.push({
      id,
      name: normalizeText(raw.name) || id,
      status: normalizeText(raw.status),
      group: normalizeText(raw.group),
      serial_number: normalizeText(raw.serial_number),
    });
  }
  return profiles;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as BrowserProviderProfileImportRequest;
    if (body.provider_type !== 'adspower') {
      return NextResponse.json({ error: '当前仅支持批量导入 AdsPower Profile' }, { status: 400 });
    }

    const profiles = normalizeProfiles(body.profiles);
    if (profiles.length === 0) {
      return NextResponse.json({ error: '没有可导入的 Profile' }, { status: 400 });
    }

    const sourceConfig = body.source_config_id ? getBrowserProviderConfigRaw(body.source_config_id) : null;
    const existingContexts = new Set(listBrowserProviderConfigs().map((config) => config.context_id));
    const created: BrowserProviderProfileImportResponse['created'] = [];
    const skipped: BrowserProviderProfileImportResponse['skipped'] = [];

    for (const profile of profiles) {
      const contextId = `adspower:${profile.id}`;
      if (existingContexts.has(contextId)) {
        skipped.push({ profile_id: profile.id, name: profile.name, reason: '已存在' });
        continue;
      }

      try {
        const config = createBrowserProviderConfig({
          provider_type: 'adspower',
          display_name: profile.name || `AdsPower ${profile.id}`,
          enabled: body.enabled,
          api_base_url: body.api_base_url || sourceConfig?.api_base_url,
          api_key: body.api_key || sourceConfig?.api_key,
          profile_id: profile.id,
          profile_name: profile.name,
          aliases: profile.name ? [profile.name] : [],
          notes: formatAdsPowerProfileNotes(profile),
        });
        created.push(config);
        existingContexts.add(config.context_id);
      } catch (error) {
        skipped.push({
          profile_id: profile.id,
          name: profile.name,
          reason: error instanceof Error ? error.message : '导入失败',
        });
      }
    }

    return NextResponse.json<BrowserProviderProfileImportResponse>({ created, skipped }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '批量导入 Profile 失败' },
      { status: 400 },
    );
  }
}
